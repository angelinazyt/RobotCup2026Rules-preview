(() => {
  "use strict";

  const data = window.RULES_DATA;
  if (!data) throw new Error("Rules data was not loaded.");

  const pagesElement = document.querySelector("#pages");
  const searchInput = document.querySelector("#rule-search");
  const clearSearchButton = document.querySelector("#clear-search");
  const searchMeta = document.querySelector("#search-meta");
  const searchPanel = document.querySelector("#search-panel");
  const browsePanel = document.querySelector("#browse-panel");
  const searchResults = document.querySelector("#search-results");
  const resultCount = document.querySelector("#result-count");
  const clauseLinks = document.querySelector("#clause-links");
  const operationalLinks = document.querySelector("#operational-links");
  const menuButton = document.querySelector("#menu-button");
  const sidebarScrim = document.querySelector("#sidebar-scrim");
  const reader = document.querySelector("#document");
  const currentSection = document.querySelector("#current-section");
  const currentPage = document.querySelector("#current-page");
  const upstreamCheckButton = document.querySelector("#upstream-check");
  const upstreamButtonText = document.querySelector("#upstream-button-text");
  const upstreamDot = document.querySelector("#upstream-dot");
  const upstreamPanel = document.querySelector("#upstream-panel");
  const upstreamCloseButton = document.querySelector("#upstream-close");
  const upstreamTitle = document.querySelector("#upstream-title");
  const upstreamSummary = document.querySelector("#upstream-summary");
  const upstreamLocalRef = document.querySelector("#upstream-local-ref");
  const upstreamLocalSha = document.querySelector("#upstream-local-sha");
  const upstreamRemoteSha = document.querySelector("#upstream-remote-sha");
  const upstreamCheckedAt = document.querySelector("#upstream-checked-at");
  const versionChannel = document.querySelector("#version-channel");
  const versionRef = document.querySelector("#version-ref");
  const versionDate = document.querySelector("#version-date");
  const editionValue = document.querySelector("#edition-value");
  const sourceValue = document.querySelector("#source-value");
  const coverageValue = document.querySelector("#coverage-value");

  const operationalGroups = [
    {
      title: "Before a match",
      links: ["competition-1", "rule-4-1", "rule-5-1", "rule-6-1", "rule-6-2"]
    },
    {
      title: "Robot legality",
      links: ["rule-3-5", "rule-3-6", "rule-3-7", "rule-3-8", "rule-3-9", "rule-3-10"]
    },
    {
      title: "Game states and timing",
      links: ["rule-7-1", "rule-7-2", "rule-7-6", "rule-7-7", "rule-7-8", "rule-7-9"]
    },
    {
      title: "Starts and restarts",
      links: ["rule-8-1", "rule-8-2", "rule-8-3", "rule-13", "rule-14", "rule-15", "rule-16", "rule-17"]
    },
    {
      title: "Penalties and misconduct",
      links: ["rule-12-1", "rule-12-2", "rule-12-3", "rule-12-4", "rule-12-5", "rule-12-9"]
    },
    {
      title: "Officials and disputes",
      links: ["rule-5", "rule-6", "rule-6-5", "part-v"]
    }
  ];

  const headingById = new Map(data.headings.map((heading) => [heading.id, heading]));
  const allSegments = data.pages.flatMap((page) =>
    page.segments.map((segment) => ({ ...segment, physicalPage: page.physicalPage, printedPage: page.printedPage, pdfHref: page.pdfHref }))
  );

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeSearch(value) {
    return value
      .toLocaleLowerCase("en")
      .replace(/([a-z])-\s+([a-z])/g, "$1$2")
      // The rulebook writes "\u00a7 12.5" with a space. Users type "\u00a712.5" without
      // one, so separate the section sign from an adjacent number.
      .replace(/\u00a7\s*(?=\d)/g, "\u00a7 ")
      .replace(/[^a-z0-9\u00a7]+/g, " ")
      .trim();
  }

  // "12.5" normalizes to "12 5", so a clause query becomes a token sequence.
  // Recovering the dotted number lets an exact clause outrank its subsections.
  function clauseNumberFromQuery(normalizedQuery) {
    const match = normalizedQuery.match(/^(?:\u00a7\s*)?(\d+(?:\s+\d+)*)$/);
    return match ? match[1].split(/\s+/).join(".") : null;
  }

  function displayPageLabel(page) {
    return page.printedPage ? `Rulebook p. ${page.printedPage}` : `PDF p. ${page.physicalPage}`;
  }

  function setUpstreamState(state, title, summary, remoteSha = "Not checked") {
    upstreamDot.dataset.state = state;
    upstreamTitle.textContent = title;
    upstreamSummary.textContent = summary;
    upstreamRemoteSha.textContent = remoteSha;
    upstreamCheckedAt.textContent = new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  }

  function openUpstreamPanel() {
    upstreamPanel.hidden = false;
    upstreamCheckButton.setAttribute("aria-expanded", "true");
  }

  function closeUpstreamPanel() {
    upstreamPanel.hidden = true;
    upstreamCheckButton.setAttribute("aria-expanded", "false");
  }

  // Read-only, unauthenticated. The Contents API only returns a JSON blob
  // descriptor for files up to 1 MB and Rules.pdf is far larger, so the blob SHA
  // is read from the Git tree instead. No credentials are ever sent.
  async function githubJson(url) {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) {
      const rateLimited = response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
      const error = new Error(rateLimited ? "GitHub API rate limit reached" : `GitHub returned ${response.status}`);
      error.rateLimited = rateLimited;
      throw error;
    }
    return response.json();
  }

  async function checkUpstream() {
    const baseline = data.meta.upstream;
    const repositoryPath = new URL(baseline.repository).pathname.replace(/^\//, "");
    const api = `https://api.github.com/repos/${repositoryPath}`;

    upstreamCheckButton.disabled = true;
    upstreamButtonText.textContent = "Checking...";
    upstreamDot.dataset.state = "checking";
    openUpstreamPanel();
    upstreamTitle.textContent = "Checking upstream";
    upstreamSummary.textContent = `Reading the ${baseline.artifact} artifact on upstream ${baseline.branch}.`;

    try {
      const branchRef = await githubJson(`${api}/branches/${encodeURIComponent(baseline.branch)}`);
      const headCommitSha = branchRef?.commit?.sha;
      if (typeof headCommitSha !== "string" || !headCommitSha) {
        throw new Error(`Upstream ${baseline.branch} head commit could not be read`);
      }

      const tree = await githubJson(`${api}/git/trees/${encodeURIComponent(headCommitSha)}`);
      const entry = (tree?.tree || []).find((item) => item.path === baseline.artifact);
      if (!entry || typeof entry.sha !== "string" || !entry.sha) {
        throw new Error(`${baseline.artifact} was not found in the upstream ${baseline.branch} tree`);
      }

      if (entry.sha === baseline.rulesPdfGitBlobSha) {
        setUpstreamState(
          "current",
          "Up to date",
          `This tagged Hub PDF matches the ${baseline.artifact} artifact on upstream ${baseline.branch}. A matching artifact does not by itself make the document a final release.`,
          entry.sha.slice(0, 10)
        );
        upstreamButtonText.textContent = "Up to date";
      } else {
        setUpstreamState(
          "update",
          "Update detected",
          `Upstream ${baseline.branch} has a different ${baseline.artifact}. It has not been imported, diffed, or reviewed, and the reviewed Hub version remains unchanged.`,
          entry.sha.slice(0, 10)
        );
        upstreamButtonText.textContent = "Update found";
      }
    } catch (error) {
      const detail = error && error.message ? error.message : "the request failed";
      setUpstreamState(
        "error",
        "Check unavailable",
        `The upstream status could not be verified (${detail}). This says nothing about whether an update exists; the current Hub version remains unchanged.`,
        "Unavailable"
      );
      upstreamButtonText.textContent = "Check failed";
    } finally {
      upstreamCheckButton.disabled = false;
    }
  }

  function splitRuleHeading(segment) {
    if (segment.continuation) return { text: segment.text, heading: false };
    const lines = segment.text.split("\n");
    if (segment.contextId.startsWith("part-") || segment.contextId.startsWith("competition-")) {
      lines.shift();
      return { text: lines.join("\n").trim(), heading: true };
    }
    if (!segment.contextId.startsWith("rule-")) return { text: segment.text, heading: false };
    const firstLine = lines.shift() || "";
    const number = segment.label.replace(/[^0-9.]/g, "");
    const prefixMatch = firstLine.match(new RegExp(`^\\s*\\u00a7\\s*${number.replaceAll(".", "\\.")}\\s+`));
    if (!prefixMatch) return { text: segment.text, heading: true };

    let remainder = firstLine.slice(prefixMatch[0].length);
    if (remainder.toLocaleLowerCase("en").startsWith(segment.title.toLocaleLowerCase("en"))) {
      remainder = remainder.slice(segment.title.length).replace(/^\s*[:.]?\s*/, "");
    }
    const body = [remainder, ...lines].join("\n").trim();
    return { text: body, heading: true };
  }

  function segmentMarkup(segment, page) {
    const parsed = splitRuleHeading(segment);
    const isAppendix = page.physicalPage >= 70;
    const shouldShowHeading = !segment.continuation && segment.contextId !== "front-cover" && !isAppendix;
    const heading = shouldShowHeading
      ? `<h2 class="clause-heading"><a href="#${escapeHtml(segment.contextId)}">${escapeHtml(segment.label)}</a><span>${escapeHtml(segment.title)}</span></h2>`
      : segment.continuation
        ? `<span class="continuation-label">${escapeHtml(segment.label)} continued</span>`
        : "";
    const bodyText = parsed.heading ? parsed.text : segment.text;
    const body = bodyText ? `<pre class="source-text">${escapeHtml(bodyText)}</pre>` : "";
    return `<section class="source-segment" id="${escapeHtml(segment.id)}" data-context="${escapeHtml(segment.contextId)}">${heading}${body}</section>`;
  }

  function pageMarkup(page) {
    const imageAnchor = page.imagePrimary ? page.segments[0]?.contextId : null;
    const imageMarkup = page.image
      ? `<figure class="page-visual${page.imagePrimary ? " primary" : ""}"${imageAnchor ? ` id="${escapeHtml(imageAnchor)}"` : ""}>
          <img src="${escapeHtml(page.image)}" alt="Official rendered image of PDF page ${page.physicalPage}" loading="lazy" width="1020" height="1320">
          <figcaption>Official PDF page ${page.physicalPage}${page.printedPage ? ` / rulebook page ${page.printedPage}` : ""}</figcaption>
        </figure>`
      : "";
    const segments = page.segments.map((segment) => segmentMarkup(segment, page)).join("");
    const content = page.imagePrimary
      ? `${imageMarkup}<details class="appendix-extraction"><summary>Searchable extracted text</summary>${segments}</details>`
      : `${segments}${imageMarkup}`;

    return `<article class="page-sheet" id="page-${page.physicalPage}" data-physical-page="${page.physicalPage}" data-page-label="${escapeHtml(page.pageLabel)}">
      <header class="page-bar">
        <span>${escapeHtml(page.pageLabel)} <span aria-hidden="true">/</span> PDF ${page.physicalPage}</span>
        <a href="${escapeHtml(page.pdfHref)}" target="_blank" rel="noreferrer">Open source page</a>
      </header>
      <div class="page-content">${content}</div>
    </article>`;
  }

  function renderPages() {
    pagesElement.innerHTML = data.pages.map(pageMarkup).join("");
  }

  function makeLink(heading, className) {
    return `<a class="${className}" href="#${escapeHtml(heading.id)}"><span>${escapeHtml(heading.label)}</span><span>${escapeHtml(heading.title)}</span></a>`;
  }

  // Groups a top-level entry with its subsections. Every anchor must appear
  // somewhere in this index; see the reachability assertion at startup.
  function collapsibleGroup(parent, children, parentClass) {
    if (!children.length) return makeLink(parent, parentClass);
    return `<details class="law-group">
      <summary>${makeLink(parent, parentClass)}</summary>
      <div class="subclause-list">${children.map((heading) => makeLink(heading, "subclause-link")).join("")}</div>
    </details>`;
  }

  function renderClauseIndex() {
    const headings = data.headings;
    const used = new Set();
    const take = (heading) => {
      used.add(heading.id);
      return heading;
    };

    const frontMatter = headings.filter((heading) => heading.id === "front-cover").map(take);

    // Part anchors: "part-i" is the parent of "part-i-vision" and friends.
    const partParents = headings.filter((heading) => /^part-[ivx]+$/.test(heading.id));
    const partGroups = partParents.map((parent) => {
      const children = headings.filter((heading) => heading.id.startsWith(`${parent.id}-`)).map(take);
      return collapsibleGroup(take(parent), children, "part-link");
    }).join("");

    const numbered = (prefix) => headings.filter((heading) =>
      heading.id.startsWith(prefix) && typeof heading.number === "string"
    );

    const lawGroups = numbered("rule-")
      .filter((heading) => !heading.number.includes("."))
      .map((law) => {
        const children = numbered("rule-")
          .filter((heading) => heading.number.startsWith(`${law.number}.`))
          .map(take);
        return collapsibleGroup(take(law), children, "law-link");
      }).join("");

    const competitionGroups = numbered("competition-")
      .filter((heading) => !heading.number.includes("."))
      .map((entry) => {
        const children = numbered("competition-")
          .filter((heading) => heading.number.startsWith(`${entry.number}.`))
          .map(take);
        return collapsibleGroup(take(entry), children, "part-link");
      }).join("");

    // Appendix A is the parent; each field has an overview and a detail sheet.
    const appendixParent = headingById.get("appendix-a");
    const appendixGroup = appendixParent
      ? collapsibleGroup(
          take(appendixParent),
          headings.filter((heading) => heading.id.startsWith("appendix-a-")).map(take),
          "part-link"
        )
      : "";

    const frontLinks = frontMatter.map((heading) => makeLink(heading, "part-link")).join("");
    clauseLinks.innerHTML = `${frontLinks}${partGroups}${lawGroups}${competitionGroups}${appendixGroup}`;

    const missing = headings.filter((heading) => !used.has(heading.id)).map((heading) => heading.id);
    if (missing.length) {
      console.warn(`Clause index is missing ${missing.length} anchor(s): ${missing.join(", ")}`);
    }
    return missing;
  }

  function renderOperationalIndex() {
    operationalLinks.innerHTML = operationalGroups.map((group) => {
      const links = group.links
        .map((id) => headingById.get(id))
        .filter(Boolean)
        .map((heading) => `<a href="#${escapeHtml(heading.id)}">${escapeHtml(heading.label)} ${escapeHtml(heading.title)}</a>`)
        .join("");
      return `<details class="operational-group"><summary>${escapeHtml(group.title)}</summary><div class="operational-group-links">${links}</div></details>`;
    }).join("");
  }

  function findSnippet(text, normalizedQuery, tokens) {
    const flat = text.replace(/\s+/g, " ").trim();
    const lower = flat.toLocaleLowerCase("en");
    let index = lower.indexOf(normalizedQuery);
    if (index < 0) {
      // Fall back to the earliest token that actually occurs, ignoring misses.
      const found = tokens.map((token) => lower.indexOf(token)).filter((at) => at >= 0);
      index = found.length ? Math.min(...found) : 0;
    }
    const start = Math.max(0, index - 72);
    const end = Math.min(flat.length, index + 170);
    return `${start > 0 ? "..." : ""}${flat.slice(start, end)}${end < flat.length ? "..." : ""}`;
  }

  // Match against the raw text and escape each piece separately. Highlighting
  // escaped HTML would let a query like "amp" or "quot" wrap <mark> inside an
  // entity and render broken markup.
  function highlight(text, tokens) {
    const usable = tokens.filter((token) => token.length > 1).sort((a, b) => b.length - a.length);
    if (!usable.length) return escapeHtml(text);
    const pattern = usable.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const parts = String(text).split(new RegExp(`(${pattern})`, "gi"));
    const matcher = new RegExp(`^(?:${pattern})$`, "i");
    return parts
      .map((part) => (matcher.test(part) ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
      .join("");
  }

  function search(query) {
    const normalizedQuery = normalizeSearch(query);
    const tokens = normalizedQuery.split(" ").filter(Boolean);
    if (!normalizedQuery) return [];
    const queriedClause = clauseNumberFromQuery(normalizedQuery);

    return allSegments
      .map((segment) => {
        const title = normalizeSearch(`${segment.label} ${segment.title}`);
        const text = normalizeSearch(segment.searchText);
        if (!tokens.every((token) => title.includes(token) || text.includes(token))) return null;
        let score = 0;
        if (title === normalizedQuery) score += 140;
        if (title.includes(normalizedQuery)) score += 80;
        if (text.includes(normalizedQuery)) score += 35;
        tokens.forEach((token) => {
          if (title.includes(token)) score += 18;
          const occurrences = text.split(token).length - 1;
          score += Math.min(occurrences, 8);
        });
        // An exact clause-number query should surface that clause first, ahead
        // of its own subsections and of passages that merely cite it.
        if (queriedClause && segment.number === queriedClause && !segment.continuation) {
          score += 260;
        }
        if (segment.continuation) score -= 2;
        return { ...segment, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.physicalPage - b.physicalPage)
      .slice(0, 100);
  }

  function renderSearch(query) {
    const normalizedQuery = normalizeSearch(query);
    const tokens = normalizedQuery.split(" ").filter(Boolean);
    const active = Boolean(normalizedQuery);
    clearSearchButton.classList.toggle("visible", active);
    searchPanel.hidden = !active;
    browsePanel.hidden = active;

    if (!active) {
      searchMeta.textContent = `${data.meta.physicalPages} PDF pages indexed`;
      return;
    }

    const results = search(query);
    resultCount.textContent = results.length === 100 ? "100+" : String(results.length);
    searchMeta.textContent = `${results.length === 100 ? "100+" : results.length} matching source passages`;
    if (!results.length) {
      searchResults.innerHTML = `<div class="empty-results">No matching source passage.</div>`;
      return;
    }

    searchResults.innerHTML = results.map((result) => {
      const snippet = findSnippet(result.searchText, normalizedQuery, tokens);
      return `<a class="search-result" href="#${escapeHtml(result.id)}">
        <span class="result-topline"><span>${escapeHtml(result.label)}${result.continuation ? " (continued)" : ""}</span><span>${escapeHtml(displayPageLabel(result))}</span></span>
        <strong class="result-title">${highlight(result.title, tokens)}</strong>
        <p class="result-snippet">${highlight(snippet, tokens)}</p>
      </a>`;
    }).join("");
  }

  function closeSidebarOnMobile() {
    if (window.matchMedia("(max-width: 820px)").matches) {
      document.body.classList.remove("sidebar-open");
      menuButton.setAttribute("aria-expanded", "false");
    }
  }

  function revealHashTarget() {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const details = target.closest("details");
    if (details) details.open = true;
    window.setTimeout(() => target.scrollIntoView({ block: "start" }), 0);
  }

  function setupReadingPosition() {
    const pageElements = [...document.querySelectorAll(".page-sheet")];
    let scheduled = false;

    function update() {
      scheduled = false;
      const readerTop = reader.getBoundingClientRect().top;
      const readingLine = readerTop + 92;
      const activePage = pageElements.find((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top <= readingLine && rect.bottom > readingLine;
      }) || pageElements.find((element) => element.getBoundingClientRect().bottom > readingLine) || pageElements.at(-1);
      if (!activePage) return;

      const physicalPage = Number(activePage.dataset.physicalPage);
      const page = data.pages[physicalPage - 1];
      const visibleSegments = page.segments.filter((segment) => {
        const element = document.getElementById(segment.id);
        return element && element.getBoundingClientRect().top <= readingLine;
      });
      const visibleSegment = visibleSegments.at(-1) || page.segments[0];
      currentSection.textContent = visibleSegment ? `${visibleSegment.label} ${visibleSegment.title}` : page.pageLabel;
      currentPage.textContent = `PDF ${physicalPage} / ${data.meta.physicalPages}`;
    }

    reader.addEventListener("scroll", () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  renderPages();
  const missingAnchors = renderClauseIndex();
  renderOperationalIndex();
  setupReadingPosition();

  // Report measured coverage rather than asserting completeness.
  const clauseCoverage = document.querySelector("#clause-coverage");
  if (clauseCoverage) {
    clauseCoverage.textContent = missingAnchors.length
      ? `${data.headings.length - missingAnchors.length} / ${data.headings.length}`
      : `All ${data.headings.length}`;
  }

  // Every version-bearing string in the shell is rendered from generated data,
  // so an import cannot leave the header advertising a stale edition.
  function renderDocumentMetadata() {
    const meta = data.meta;
    const upstream = meta.upstream;
    const isDraft = String(upstream.documentStatus).toLowerCase() === "draft";
    const channelLabel = `${upstream.refType === "branch" ? "Branch" : "Tagged"} ${isDraft ? "draft" : "release"}`;

    versionChannel.textContent = channelLabel;
    versionRef.textContent = upstream.ref;
    versionDate.textContent = formatIsoDate(meta.versionDate);
    versionDate.setAttribute("datetime", meta.versionDate);

    editionValue.textContent = `${channelLabel} ${upstream.ref}`;
    sourceValue.textContent = meta.source;
    coverageValue.textContent = `${meta.physicalPages} / ${meta.physicalPages} pages (${meta.numberedPages} numbered)`;

    searchMeta.textContent = `${meta.physicalPages} PDF pages indexed`;
    document.title = `${meta.shortTitle} ${upstream.ref}`;

    upstreamLocalRef.textContent = upstream.ref;
    upstreamLocalSha.textContent = upstream.rulesPdfGitBlobSha.slice(0, 10);
    upstreamSummary.textContent = `Baseline verified on ${formatIsoDate(upstream.verifiedOn)}. Status: ${meta.status}.`;
  }

  function formatIsoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return String(value ?? "—");
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" })
      .format(new Date(Date.UTC(year, month - 1, day)));
  }

  renderDocumentMetadata();

  searchInput.addEventListener("input", (event) => renderSearch(event.target.value));
  upstreamCheckButton.addEventListener("click", checkUpstream);
  upstreamCloseButton.addEventListener("click", closeUpstreamPanel);
  clearSearchButton.addEventListener("click", () => {
    searchInput.value = "";
    renderSearch("");
    searchInput.focus();
  });
  menuButton.addEventListener("click", () => {
    const open = document.body.classList.toggle("sidebar-open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  sidebarScrim.addEventListener("click", closeSidebarOnMobile);
  document.querySelector("#sidebar").addEventListener("click", (event) => {
    if (event.target.closest("a")) closeSidebarOnMobile();
  });
  window.addEventListener("hashchange", () => {
    revealHashTarget();
    closeSidebarOnMobile();
  });
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase("en") === "k") {
      event.preventDefault();
      searchInput.focus();
      document.body.classList.add("sidebar-open");
    }
    if (event.key === "Escape") {
      closeUpstreamPanel();
      closeSidebarOnMobile();
      if (document.activeElement === searchInput && searchInput.value) {
        searchInput.value = "";
        renderSearch("");
      }
    }
  });

  renderSearch("");
  revealHashTarget();
})();
