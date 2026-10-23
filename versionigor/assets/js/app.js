const BASE = "/versionigor";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const nbsp = (value) =>
  String(value ?? "").replace(/[ \t]+([—–])/g, "\u00a0$1");
let site,
  catalog,
  translations,
  media,
  lang = "ru",
  rates = null;
let currentWork = null,
  photoIndex = 0,
  sending = false,
  idempotencyKey = null,
  lastPayload = null;
let hasSubmitted = false,
  previousRoute = "",
  portraitFrame = 0;
let fontRequested = false;
let formNotice = "";
const categories = {
  paintings: "categoryPaintings",
  plaster: "categoryPlaster",
  "toon-art": "categoryToon",
  "gift-sets": "categoryGifts",
};
const t = (key) => nbsp(translations[lang][key] ?? key);
const local = (value) => nbsp(value?.[lang] ?? value?.ru ?? "");
const series = (work) =>
  local(catalog.series.find((s) => s.id === work.series)?.title);
const category = (work) => t(categories[work.category]);
const workURL = (work) =>
  `${BASE}/work/${encodeURIComponent(work.slug)}${location.search}`;
const readStorage = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStorage = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
};
const asset = (name) =>
  media.byName?.[name.toLowerCase()] ?? media.byName?.[name] ?? null;
const safeAsset = (path) =>
  typeof path === "string" &&
  /^\/versionigor\/assets\/(media|fonts)\//.test(path) &&
  !path.includes("..")
    ? path
    : null;
const images = (work) =>
  (media.products?.[work.id] ?? []).map(safeAsset).filter(Boolean);
const photoAlt = (work, index = 0) =>
  `${local(work.title)}. ${t("photo")} ${index + 1}. ${local(work.materials)}.`;

function priceHTML(work) {
  const rub = `${work.price.toLocaleString("en-US")} RUB`;
  const amount = (currency) =>
    rates
      ? Math.round(work.price / rates[currency]).toLocaleString("en-US")
      : null;
  if (lang === "en")
    return `<span class="price">${rates ? `≈ ${amount("EUR")} EUR` : esc(t("priceRequest"))}</span>`;
  return `<span class="price">${rub}</span>${rates ? `<span class="approx-price">≈ ${amount("EUR")} EUR / ${amount("USD")} USD</span>` : ""}`;
}

function imageHTML(work, index = 0, eager = false) {
  const source = images(work)[index];
  return source
    ? `<img src="${esc(source)}" alt="${esc(photoAlt(work, index))}" width="900" height="900" loading="${eager ? "eager" : "lazy"}" decoding="async" data-work-image>`
    : `<div class="media-empty"><span class="empty-id" aria-hidden="true">${esc(work.id.toUpperCase())}</span><span>${esc(t("imageUnavailable"))}</span></div>`;
}

function watchImages(root = document) {
  $$("img[data-work-image]", root).forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        const fallback = document.createElement("div");
        fallback.className = "media-empty";
        fallback.textContent = t("imageUnavailable");
        img.replaceWith(fallback);
      },
      { once: true },
    );
  });
}

function setBrandMedia() {
  $$("[data-media]").forEach((img) => {
    const path = safeAsset(asset(img.dataset.media));
    if (!path) return;
    if (img.getAttribute("src") !== path) img.src = path;
    img.hidden = false;
    if (img.dataset.media === "medasha.png")
      img.alt = lang === "ru" ? "Дарья, художница" : "Darya, the artist";
    img.addEventListener(
      "error",
      () => {
        img.hidden = true;
      },
      { once: true },
    );
  });
  const icon = safeAsset(asset("favidasha.jpg"));
  if (icon && !$("link[rel=icon]")) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = icon;
    document.head.append(link);
  }
  const manuscript = safeAsset(asset("manuscript.ttf"));
  if (manuscript && !fontRequested && "FontFace" in window) {
    fontRequested = true;
    const face = new FontFace("Manuscript", `url("${manuscript}")`);
    face
      .load()
      .then((font) => {
        document.fonts.add(font);
        document.documentElement.classList.add("hand-font");
      })
      .catch(() => {});
  }
  const meet = site.social?.instagram;
  if (
    meet &&
    /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]+\/?$/.test(meet)
  ) {
    $("#meet-link").href = meet;
    $("#meet-link").target = "_blank";
    $("#meet-link").rel = "noopener noreferrer";
  }
  // Only verified social URLs from site.json may appear here.
  const socials = Object.entries(site.social ?? {}).filter(([, url]) => {
    try {
      return (
        [
          "www.instagram.com",
          "instagram.com",
          "www.threads.net",
          "www.threads.com",
          "threads.net",
          "threads.com",
          "www.behance.net",
          "behance.net",
          "www.linkedin.com",
          "linkedin.com",
        ].includes(new URL(url).hostname) && url.startsWith("https://")
      );
    } catch {
      return false;
    }
  });
  $("#social-links").innerHTML = socials
    .map(
      ([name, url]) =>
        `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(name)}</a>`,
    )
    .join("");
}

function translate() {
  document.documentElement.lang = lang;
  $$("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  $$("[data-i18n-aria]").forEach((node) =>
    node.setAttribute("aria-label", t(node.dataset.i18nAria)),
  );
  $$("[data-lang]").forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.lang === lang)),
  );
  $("#navigation").setAttribute(
    "aria-label",
    lang === "ru" ? "Навигация" : "Navigation",
  );
  $(".down-arrow").setAttribute("aria-label", t("works"));
  $("#contact-name").placeholder = t("namePlaceholder");
  $("#contact-wishes").placeholder = t("wishPlaceholder");
  $("#year").textContent = String(new Date().getFullYear());
  updateContactMethod();
  if (hasSubmitted) validateForm();
  if (sending) $(".submit-button span").textContent = t("sending");
  renderFormNotice();
  setBrandMedia();
}

function filterState() {
  const query = new URLSearchParams(location.search);
  const view = ["series", "category"].includes(query.get("view"))
    ? query.get("view")
    : "all";
  const validSeries = catalog.series.some((s) => s.id === query.get("series"));
  const validCategory = Object.hasOwn(categories, query.get("category"));
  return {
    view,
    series: view === "series" && validSeries ? query.get("series") : "",
    category: view === "category" && validCategory ? query.get("category") : "",
  };
}

function renderGallery() {
  const state = filterState();
  $("#view-filter").value = state.view;
  $("#secondary-label").hidden = state.view === "all";
  $("#secondary-title").textContent = t(
    state.view === "series" ? "seriesLabel" : "categoryLabel",
  );
  const choices =
    state.view === "series"
      ? catalog.series.map((s) => [s.id, local(s.title)])
      : Object.keys(categories).map((id) => [id, t(categories[id])]);
  $("#secondary-filter").innerHTML =
    `<option value="">${esc(t(state.view === "series" ? "allSeries" : "allCategories"))}</option>${choices.map(([id, title]) => `<option value="${id}">${esc(title)}</option>`).join("")}`;
  $("#secondary-filter").value = state[state.view] ?? "";
  const works = catalog.works
    .filter(
      (w) =>
        (!state.series || w.series === state.series) &&
        (!state.category || w.category === state.category),
    )
    .sort((a, b) => a.order - b.order);
  $("#result-count").textContent = `${works.length} ${t("results")}`;
  $("#rate-status").textContent = rates
    ? `${t("rateDate")} ${rates.date} · CBR`
    : t("rateUnavailable");
  $("#reset-filter").hidden = state.view === "all";
  $("#gallery-grid").innerHTML = works.length
    ? works
        .map(
          (work) =>
            `<article class="work-card" id="card-${work.id}"><div class="work-image"><a class="work-open" data-work="${work.id}" href="${esc(workURL(work))}" aria-label="${esc(`${t("discover")}: ${local(work.title)}`)}">${imageHTML(work)}<div class="work-veil"><div><span class="eyebrow">${esc(series(work))} / ${esc(category(work))}</span><h3>${esc(local(work.title))}</h3><p>${esc(local(work.line))}</p><p class="keywords">${esc(work.keywords[lang].join(" · "))}${work.year ? ` · ${esc(work.year)}` : ""}</p></div><div class="veil-bottom"><div class="price-block">${priceHTML(work)}</div>${work.unique ? `<p class="eyebrow">${esc(t("unique"))}</p>` : ""}<span class="discover">${esc(t("discover"))}<span aria-hidden="true">↗</span></span></div></div></a></div><div class="work-caption"><div><h3>${esc(local(work.title))}</h3><p class="caption-meta">${esc(series(work))} · ${esc(t(work.status))}</p></div><div class="price-block">${priceHTML(work)}</div></div></article>`,
        )
        .join("")
    : `<p class="gallery-empty">${esc(t("empty"))}</p>`;
  watchImages($("#gallery-grid"));
  bindWorkLinks($("#gallery-grid"));
}

function bindWorkLinks(root) {
  $$("[data-work]", root).forEach((link) =>
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const card = link.closest(".work-card");
      if (
        card &&
        matchMedia("(hover:none), (pointer:coarse)").matches &&
        event.detail !== 0 &&
        !card.classList.contains("is-revealed")
      ) {
        event.preventDefault();
        $$(".work-card.is-revealed").forEach((node) =>
          node.classList.remove("is-revealed"),
        );
        card.classList.add("is-revealed");
        return;
      }
      event.preventDefault();
      const work = catalog.works.find((w) => w.id === link.dataset.work);
      if (work) navigate(workURL(work), { focusId: card?.id ?? null });
    }),
  );
}

function updateFilter(view, value = "") {
  const query = new URLSearchParams(location.search);
  query.delete("view");
  query.delete("series");
  query.delete("category");
  if (view !== "all") {
    query.set("view", view);
    if (value) query.set(view, value);
  }
  navigate(`${BASE}${query.size ? `?${query}` : ""}#works`, {
    modal: false,
    scroll: false,
  });
}

function navigate(url, options = {}) {
  const modal = options.modal ?? true;
  const background = {
    scrollY: window.scrollY,
    focusId: options.focusId ?? history.state?.focusId ?? null,
  };
  history.replaceState({ ...history.state, ...background }, "", location.href);
  history.pushState(
    {
      ...background,
      modalOrigin: modal,
      returnURL: `${location.pathname}${location.search}${location.hash}`,
    },
    "",
    url,
  );
  renderRoute(options.scroll !== false);
}

function closeOverlay() {
  if (sending) return;
  if (history.state?.modalOrigin) history.back();
  else {
    const query = new URLSearchParams(location.search);
    query.delete("type");
    query.delete("work");
    history.replaceState(
      { ...history.state, modalOrigin: false },
      "",
      `${BASE}${query.size ? `?${query}` : ""}#works`,
    );
    renderRoute();
  }
}

function showDialog(dialog) {
  for (const other of [$("#work-overlay"), $("#contact-overlay")])
    if (other !== dialog && other.open) other.close();
  document.body.classList.add("overlay-open");
  if (!dialog.open) dialog.showModal();
}

function renderWork(work) {
  if (currentWork?.id !== work.id) photoIndex = 0;
  currentWork = work;
  const allImages = images(work);
  photoIndex = Math.min(photoIndex, Math.max(0, allImages.length - 1));
  const contactURL = (type) => {
    const q = new URLSearchParams(location.search);
    q.set("type", type);
    q.set("work", work.id);
    return `${BASE}/contact?${q}`;
  };
  const detail = (key, value) =>
    `<div><dt>${esc(t(key))}</dt><dd>${esc(value || t("unknown"))}</dd></div>`;
  const related = catalog.works
    .filter((w) => w.id !== work.id && w.series === work.series)
    .slice(0, 3);
  $("#work-content").innerHTML =
    `<div class="work-layout"><div class="work-photos"><div class="work-main-image" id="work-main-image">${imageHTML(work, photoIndex, true)}</div>${allImages.length > 1 ? `<div class="photo-controls"><button type="button" data-photo-step="-1" aria-label="${esc(t("previousPhoto"))}">←</button><span id="photo-count">${photoIndex + 1} / ${allImages.length}</span><button type="button" data-photo-step="1" aria-label="${esc(t("nextPhoto"))}">→</button></div><div class="work-thumbs">${allImages.map((src, index) => `<button type="button" data-photo="${index}" aria-label="${esc(`${t("photo")} ${index + 1}`)}" aria-pressed="${index === photoIndex}"><img src="${esc(src)}" alt="" width="65" height="65" loading="lazy"></button>`).join("")}</div>` : ""}</div><div class="work-info"><p class="eyebrow">${esc(series(work))} / ${esc(category(work))}</p><h2 id="work-title" tabindex="-1">${esc(local(work.title))}</h2><p class="work-keywords">${esc(work.keywords[lang].join(" · "))}${work.year ? ` · ${work.year}` : ""}</p><div class="price-block">${priceHTML(work)}</div><p class="price-note">${esc(t("finalPrice"))}<br>${rates ? `${esc(t("rateDate"))} ${esc(rates.date)}` : esc(t("rateUnavailable"))}</p><p class="work-description">${esc(local(work.story))}</p><p class="reading-note">${esc(t("readingNote"))}</p><div class="details"><h3>${esc(t("details"))}</h3><dl>${detail("size", local(work.size))}${detail("materials", local(work.materials))}${detail("care", local(work.care))}${detail("availability", t(work.status))}${work.unique ? detail("unique", lang === "ru" ? "Да" : "Yes") : ""}</dl></div><div class="work-actions">${work.status !== "sold" ? `<a class="action-link primary" data-contact="purchase" href="${esc(contactURL("purchase"))}">${esc(t("purchase"))}<span aria-hidden="true">↗</span></a>` : ""}<a class="action-link" data-contact="custom" href="${esc(contactURL("custom"))}">${esc(t("similarCustom"))}<span aria-hidden="true">↗</span></a></div></div></div>${related.length ? `<section class="related-works"><h3>${esc(t("related"))}</h3><div class="related-grid">${related.map((w) => `<a class="related-card" data-work="${w.id}" href="${esc(workURL(w))}"><div class="work-image">${imageHTML(w)}</div><h4>${esc(local(w.title))}</h4><div class="price-block">${priceHTML(w)}</div></a>`).join("")}</div></section>` : ""}`;
  watchImages($("#work-content"));
  bindWorkLinks($("#work-content"));
  bindContactLinks($("#work-content"));
  $$("[data-photo]", $("#work-content")).forEach((button) =>
    button.addEventListener("click", () =>
      setPhoto(Number(button.dataset.photo)),
    ),
  );
  $$("[data-photo-step]", $("#work-content")).forEach((button) =>
    button.addEventListener("click", () =>
      setPhoto(photoIndex + Number(button.dataset.photoStep)),
    ),
  );
  const dialog = $("#work-overlay");
  showDialog(dialog);
  if (previousRoute !== location.pathname) {
    dialog.scrollTop = 0;
    const previousFocus =
      history.state?.focusId && document.getElementById(history.state.focusId);
    (previousFocus?.matches("a,button")
      ? previousFocus
      : $("#work-title")
    ).focus({ preventScroll: true });
  }
  metadata(work);
}

function setPhoto(index) {
  const all = images(currentWork);
  if (!all.length) return;
  photoIndex = (index + all.length) % all.length;
  $("#work-main-image").innerHTML = imageHTML(currentWork, photoIndex, true);
  watchImages($("#work-main-image"));
  $("#photo-count").textContent = `${photoIndex + 1} / ${all.length}`;
  $$("[data-photo]").forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.photo) === photoIndex),
    ),
  );
}

function bindContactLinks(root = document) {
  $$("[data-contact]", root).forEach((link, index) => {
    if (link.dataset.bound) return;
    link.dataset.bound = "true";
    link.id ||= `enquiry-${root === document ? "page" : "work"}-${index}`;
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      const query = new URLSearchParams(location.search);
      query.set("type", link.dataset.contact);
      if (currentWork && $("#work-overlay").open)
        query.set("work", currentWork.id);
      else query.delete("work");
      navigate(`${BASE}/contact?${query}`, { focusId: link.id });
    });
  });
}

function renderContact() {
  const query = new URLSearchParams(location.search);
  const type = ["general", "purchase", "custom", "collaboration"].includes(
    query.get("type"),
  )
    ? query.get("type")
    : "general";
  const work = catalog.works.find((w) => w.id === query.get("work"));
  $("#request-type").value = type;
  $("#contact-title").textContent = t(
    type === "purchase" ? "formPurchaseTitle" : "formGeneralTitle",
  );
  $("#selected-work").hidden = !work;
  $("#selected-work").innerHTML = work
    ? `${images(work)[0] ? `<img src="${esc(images(work)[0])}" alt="${esc(photoAlt(work))}" width="85" height="85" data-work-image>` : ""}<span class="eyebrow">${esc(series(work))}</span><br><strong>${esc(local(work.title))}</strong><br><span>${priceHTML(work)}</span>`
    : "";
  watchImages($("#selected-work"));
  $("#contact-mailto").href =
    `mailto:${site.email}?subject=${encodeURIComponent(work ? `${t(type === "purchase" ? "purchaseType" : "customType")}: ${local(work.title)}` : "Darya Mucha")}`;
  showDialog($("#contact-overlay"));
  metadata();
  if (previousRoute !== location.pathname) {
    $("#contact-overlay").scrollTop = 0;
    $("#contact-title").setAttribute("tabindex", "-1");
    $("#contact-title").focus({ preventScroll: true });
  }
}

function renderRoute(restore = true) {
  const query = new URLSearchParams(location.search);
  const nextLang = ["ru", "en"].includes(query.get("lang"))
    ? query.get("lang")
    : (readStorage("versionigor-language") ?? "ru");
  lang = ["ru", "en"].includes(nextLang) ? nextLang : "ru";
  translate();
  renderGallery();
  let slug = null;
  if (location.pathname.startsWith(`${BASE}/work/`)) {
    try {
      slug = decodeURIComponent(
        location.pathname.slice(`${BASE}/work/`.length).replace(/\/$/, ""),
      );
    } catch {
      slug = "__invalid_route__";
    }
  }
  const work = catalog.works.find((w) => w.slug === slug);
  if (slug && work) renderWork(work);
  else if (slug) {
    currentWork = null;
    $("#work-content").innerHTML =
      `<div class="overlay-error"><h2 id="work-title">${esc(t("notFound"))}</h2><a href="${BASE}${location.search}" data-gallery-return>${esc(t("backGallery"))}</a></div>`;
    $("[data-gallery-return]").onclick = (event) => {
      event.preventDefault();
      closeOverlay();
    };
    showDialog($("#work-overlay"));
    metadata();
  } else if (location.pathname.replace(/\/$/, "") === `${BASE}/contact`)
    renderContact();
  else {
    currentWork = null;
    [$("#work-overlay"), $("#contact-overlay")].forEach((dialog) => {
      if (dialog.open) dialog.close();
    });
    document.body.classList.remove("overlay-open");
    metadata();
    if (restore)
      requestAnimationFrame(() => {
        if (history.state?.scrollY !== undefined)
          window.scrollTo({ top: history.state.scrollY, behavior: "instant" });
        else if (location.hash)
          document.getElementById(location.hash.slice(1))?.scrollIntoView();
        const node =
          history.state?.focusId &&
          document.getElementById(history.state.focusId);
        const focus = node?.matches("a,button")
          ? node
          : node?.querySelector("a,button");
        focus?.focus({ preventScroll: true });
      });
  }
  previousRoute = location.pathname;
}

function metadata(work = null) {
  const title = work
    ? `${local(work.title)}\u00a0— Darya Mucha`
    : t("pageTitle");
  const description = work ? local(work.line) : t("pageDescription");
  document.title = title;
  $("meta[name=description]").content = description;
  $('meta[property="og:title"]').content = title;
  $('meta[property="og:description"]').content = description;
  const canonical = `${site.canonicalOrigin}${work ? `${BASE}/work/${work.slug}` : BASE}`;
  $("link[rel=canonical]").href = canonical;
  $("meta[name=robots]").content = site.noindex
    ? "noindex, follow"
    : "index, follow";
  let image = $('meta[property="og:image"]');
  const src = work ? images(work)[0] : safeAsset(asset("medasha.png"));
  if (src) {
    if (!image) {
      image = document.createElement("meta");
      image.setAttribute("property", "og:image");
      document.head.append(image);
    }
    image.content = site.canonicalOrigin + src;
  } else image?.remove();
}

function updateContactMethod() {
  const method = $("#contact-method").value,
    input = $("#contact-value");
  const email = method === "email",
    phone = ["phone", "whatsapp"].includes(method);
  input.type = email ? "email" : "text";
  input.inputMode = email ? "email" : phone ? "tel" : "text";
  input.autocomplete = email ? "email" : phone ? "tel" : "off";
  input.placeholder = t(
    email ? "emailExample" : phone ? "phoneExample" : "handleExample",
  );
  $("#contact-label").textContent = t(method);
  $("#contact-help").textContent = t(
    email ? "emailHelp" : phone ? "phoneHelp" : "handleHelp",
  );
}

function validContact(method, value) {
  if (method === "email")
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
  if (["phone", "whatsapp"].includes(method))
    return (
      /^\+?[\d\s().-]+$/.test(value) &&
      value.replace(/\D/g, "").length >= 7 &&
      value.replace(/\D/g, "").length <= 15
    );
  if (method === "telegram")
    return (
      /^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(value) ||
      /^https:\/\/(t\.me|telegram\.me)\/[a-zA-Z][a-zA-Z0-9_]{4,31}\/?$/.test(
        value,
      )
    );
  if (method === "instagram")
    return (
      /^@?[a-zA-Z0-9_.]{1,30}$/.test(value) ||
      /^https:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9_.]{1,30}\/?$/.test(value)
    );
  return false;
}

function validateForm() {
  const name = $("#contact-name").value.trim(),
    contact = $("#contact-value").value.trim();
  const nameValid = name.length > 0 && name.length <= 100;
  const contactValid = validContact($("#contact-method").value, contact);
  $("#name-error").textContent = nameValid ? "" : t("nameError");
  $("#contact-error").textContent = contactValid ? "" : t("contactError");
  $("#contact-name").setAttribute("aria-invalid", String(!nameValid));
  $("#contact-value").setAttribute("aria-invalid", String(!contactValid));
  return nameValid && contactValid;
}

async function submitContact(event) {
  event.preventDefault();
  if (sending) return;
  hasSubmitted = true;
  if (!validateForm()) {
    formNotice = "formInvalid";
    renderFormNotice();
    $("[aria-invalid=true]", $("#contact-form"))?.focus();
    return;
  }
  const query = new URLSearchParams(location.search);
  const payload = {
    name: $("#contact-name").value.trim(),
    method: $("#contact-method").value,
    contact: $("#contact-value").value.trim(),
    wishes: $("#contact-wishes").value.trim(),
    type: $("#request-type").value,
    workId: query.get("work") ?? null,
    language: lang,
    sourceURL: location.href,
    website: $("#company-website").value,
  };
  const serialized = JSON.stringify(payload);
  if (lastPayload !== serialized || !idempotencyKey) {
    idempotencyKey = crypto.randomUUID();
    lastPayload = serialized;
  }
  sending = true;
  const button = $(".submit-button");
  button.disabled = true;
  $("span", button).textContent = t("sending");
  formNotice = "";
  renderFormNotice();
  try {
    const response = await fetch(`${BASE}/api/contact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: serialized,
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || result.accepted !== true)
      throw new Error(response.status === 429 ? "rateLimit" : "sendError");
    formNotice = "sent";
    renderFormNotice();
    // Keep the submitted values visible; a second identical click reuses the same key.
  } catch (error) {
    formNotice = error.message === "rateLimit" ? "rateLimit" : "sendError";
    renderFormNotice();
  } finally {
    sending = false;
    button.disabled = false;
    $("span", button).textContent = t("send");
  }
}

function renderFormNotice() {
  $("#form-status").textContent =
    formNotice === "sent"
      ? `${t("sentHeading")} ${t("sentText")}`
      : formNotice
        ? t(formNotice)
        : "";
  $("#form-status").classList.toggle(
    "is-error",
    ["formInvalid", "rateLimit", "sendError"].includes(formNotice),
  );
}

async function loadRates() {
  const valid = (value) =>
    value &&
    Number.isFinite(value.EUR) &&
    value.EUR > 0 &&
    Number.isFinite(value.USD) &&
    value.USD > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.date);
  try {
    const cached = JSON.parse(readStorage("versionigor-rates"));
    if (valid(cached)) rates = cached;
  } catch {}
  try {
    const response = await fetch(`${BASE}/api/rates`, {
      signal: AbortSignal.timeout(12000),
    });
    if (response.ok) {
      const data = await response.json();
      if (valid(data)) {
        rates = data;
        writeStorage("versionigor-rates", JSON.stringify(data));
      }
    }
  } catch {
    /* A dated last successful rate may still be displayed. */
  }
  if (rates) {
    renderGallery();
    if ($("#work-overlay").open && currentWork) renderWork(currentWork);
  }
}

function bindEvents() {
  $("#view-filter").addEventListener("change", (event) =>
    updateFilter(event.target.value),
  );
  $("#secondary-filter").addEventListener("change", (event) =>
    updateFilter($("#view-filter").value, event.target.value),
  );
  $("#reset-filter").addEventListener("click", () => updateFilter("all"));
  $$("[data-category]").forEach((link) =>
    link.addEventListener("click", (event) => {
      event.preventDefault();
      updateFilter("category", link.dataset.category);
      $("#works").scrollIntoView();
    }),
  );
  $$("[data-lang]").forEach((button) =>
    button.addEventListener("click", () => {
      const query = new URLSearchParams(location.search);
      query.set("lang", button.dataset.lang);
      writeStorage("versionigor-language", button.dataset.lang);
      history.replaceState(
        history.state,
        "",
        `${location.pathname}?${query}${location.hash}`,
      );
      renderRoute(false);
    }),
  );
  $(".menu-toggle").addEventListener("click", () => {
    const open = $("#header").classList.toggle("menu-open");
    $(".menu-toggle").setAttribute("aria-expanded", String(open));
  });
  $$("#navigation a").forEach((link) =>
    link.addEventListener("click", () => {
      $("#header").classList.remove("menu-open");
      $(".menu-toggle").setAttribute("aria-expanded", "false");
    }),
  );
  $$("[data-close]").forEach((button) =>
    button.addEventListener("click", closeOverlay),
  );
  [$("#work-overlay"), $("#contact-overlay")].forEach((dialog) =>
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeOverlay();
    }),
  );
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !document.body.classList.contains("overlay-open")
    ) {
      $("#header").classList.remove("menu-open");
      $(".menu-toggle").setAttribute("aria-expanded", "false");
    }
    if (
      $("#work-overlay").open &&
      images(currentWork ?? {}).length > 1 &&
      !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)
    ) {
      if (event.key === "ArrowRight") setPhoto(photoIndex + 1);
      if (event.key === "ArrowLeft") setPhoto(photoIndex - 1);
    }
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".work-card"))
      $$(".work-card.is-revealed").forEach((node) =>
        node.classList.remove("is-revealed"),
      );
  });
  window.addEventListener("popstate", () => renderRoute());
  $("#contact-method").addEventListener("change", () => {
    updateContactMethod();
    if (hasSubmitted) validateForm();
  });
  $("#request-type").addEventListener("change", (event) => {
    const query = new URLSearchParams(location.search);
    query.set("type", event.target.value);
    history.replaceState(history.state, "", `${location.pathname}?${query}`);
    $("#contact-title").textContent = t(
      event.target.value === "purchase"
        ? "formPurchaseTitle"
        : "formGeneralTitle",
    );
  });
  $("#contact-name").addEventListener("input", () => {
    if (hasSubmitted) validateForm();
  });
  $("#contact-value").addEventListener("input", () => {
    if (hasSubmitted) validateForm();
  });
  $("#contact-form").addEventListener("submit", submitContact);
  bindContactLinks();
  const motion = matchMedia("(prefers-reduced-motion:reduce)");
  window.addEventListener(
    "scroll",
    () => {
      if (motion.matches || portraitFrame) return;
      portraitFrame = requestAnimationFrame(() => {
        const portrait = $(".hero-portrait");
        const progress = Math.min(
          1,
          window.scrollY / Math.max(500, $(".hero").offsetHeight),
        );
        portrait.style.transform = `translateY(${progress * 50}px)`;
        portrait.style.opacity = String(1 - progress * 0.35);
        portraitFrame = 0;
      });
    },
    { passive: true },
  );
}

async function start() {
  try {
    [site, catalog, translations, media] = await Promise.all(
      ["site", "catalog", "i18n", "media"].map(async (name) => {
        const response = await fetch(`${BASE}/assets/data/${name}.json`);
        if (!response.ok) throw new Error("data");
        return response.json();
      }),
    );
    bindEvents();
    renderRoute(false);
    void loadRates();
  } catch {
    const status = $("#load-status");
    status.hidden = false;
    status.textContent =
      "Не удалось загрузить галерею / The gallery could not be loaded. daria.mucha@gmail.com";
  }
}
void start();
