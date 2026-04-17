<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RelayPool, onlyEvents } from "applesauce-relay";
import PeerCard from "./components/PeerCard.vue";

const ADVERT_KIND = 30078;
const ADVERT_D = "fips-overlay-v1";

// FIPS defaults from src/config/node.rs:374-378, plus a few popular public
// relays that are likely to mirror the adverts.
const DEFAULT_RELAYS = [
  "wss://offchain.pub",
  "wss://strfry.bitsbytom.com",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.nostr.band",
];

const relaysText = ref(DEFAULT_RELAYS.join("\n"));
const protocolFilter = ref("");
const useDTag = ref(true);
const sinceDays = ref(0);
const limit = ref(1000);
const showExpired = ref(true);
const filtersOpen = ref(false);
const status = ref("idle");
const errorMsg = ref("");
const eventCount = ref(0);
const peers = ref(new Map());

let pool = null;
let sub = null;

const relayUrls = computed(() =>
  relaysText.value
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("ws://") || s.startsWith("wss://")),
);

const nowSec = ref(Math.floor(Date.now() / 1000));
setInterval(() => {
  nowSec.value = Math.floor(Date.now() / 1000);
}, 5000);

const peerList = computed(() => {
  const list = [...peers.value.values()];
  return list
    .filter((p) => {
      if (showExpired.value) return true;
      const exp = tagValue(p.event, "expiration");
      if (!exp) return true;
      return Number(exp) >= nowSec.value;
    })
    .sort((a, b) => b.event.created_at - a.event.created_at);
});

const expiredCount = computed(() => {
  let n = 0;
  for (const p of peers.value.values()) {
    const exp = tagValue(p.event, "expiration");
    if (exp && Number(exp) < nowSec.value) n++;
  }
  return n;
});

const liveCount = computed(() => peers.value.size - expiredCount.value);

const isScanning = computed(() => sub !== null);

function tagValue(ev, name) {
  const t = ev.tags.find((x) => x[0] === name);
  return t ? t[1] : null;
}

function parseAdvert(ev) {
  try {
    if (ev.content && ev.content.trim().startsWith("{")) {
      return JSON.parse(ev.content);
    }
  } catch (_) {
    // Adverts almost always embed a JSON body, but we tolerate malformed ones
    // rather than dropping them silently so the pubkey still shows up.
  }
  return null;
}

function onEvent(ev) {
  if (!ev || ev.kind !== ADVERT_KIND) return;
  if (tagValue(ev, "d") !== ADVERT_D) return;
  eventCount.value++;
  const existing = peers.value.get(ev.pubkey);
  if (existing && existing.event.created_at >= ev.created_at) return;
  const next = new Map(peers.value);
  next.set(ev.pubkey, { event: ev, advert: parseAdvert(ev) });
  peers.value = next;
}

function stop() {
  if (sub) {
    try {
      sub.unsubscribe();
    } catch (_) {
      // RelayPool teardown is best-effort.
    }
    sub = null;
  }
  status.value = "idle";
}

function scan() {
  stop();
  errorMsg.value = "";
  peers.value = new Map();
  eventCount.value = 0;

  if (relayUrls.value.length === 0) {
    errorMsg.value = "Add at least one relay.";
    return;
  }

  if (!pool) pool = new RelayPool();

  const filter = { kinds: [ADVERT_KIND] };
  if (useDTag.value) filter["#d"] = [ADVERT_D];
  if (protocolFilter.value.trim()) {
    filter["#protocol"] = [protocolFilter.value.trim()];
  }
  if (sinceDays.value > 0) {
    filter.since = Math.floor(Date.now() / 1000) - sinceDays.value * 86400;
  }
  if (limit.value > 0) filter.limit = limit.value;

  status.value = "scanning…";

  try {
    sub = pool
      .subscription(relayUrls.value, filter)
      .pipe(onlyEvents())
      .subscribe({
        next: (ev) => {
          status.value = "live";
          onEvent(ev);
        },
        error: (e) => {
          errorMsg.value = "relay error: " + (e?.message || String(e));
          status.value = "error";
        },
        complete: () => {
          status.value = "complete";
        },
      });
  } catch (e) {
    errorMsg.value = "query failed: " + (e?.message || String(e));
    status.value = "error";
  }
}

function resetRelays() {
  relaysText.value = DEFAULT_RELAYS.join("\n");
}

function statusPillClass(s) {
  if (s === "live" || s === "scanning…") return "accent-green";
  if (s === "error") return "accent-red";
  return "";
}

onMounted(() => {
  // Start a scan immediately so visitors see live peers without clicking.
  scan();
});

onBeforeUnmount(stop);
</script>

<template>
  <header class="site-header">
    <div class="container">
      <a class="logo" href="https://fips.network" aria-label="FIPS home">
        <span class="logo-text">FIPS</span>
        <span class="logo-sub">fips.network</span>
      </a>
      <nav class="main-nav">
        <a href="https://fips.network/#what-it-does">What It Does</a>
        <a href="https://fips.network/#how-it-works">How It Works</a>
        <a href="https://fips.network/#identity">Identity</a>
        <a href="https://fips.network/#get-involved">Get Involved</a>
      </nav>
      <div class="header-actions">
        <a
          class="action-link"
          href="https://github.com/jmcorgan/fips"
          target="_blank"
          rel="noopener noreferrer"
          >GitHub</a
        >
        <a
          class="action-link bordered"
          href="https://github.com/jmcorgan/fips/tree/master/docs/design"
          target="_blank"
          rel="noopener noreferrer"
          >Docs</a
        >
      </div>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="container">
        <span class="eyebrow">peer discovery</span>
        <h1 class="hero-title">Join the mesh</h1>
        <p class="hero-tagline">
          A browser-side lens on the FIPS mesh. Queries Nostr relays for overlay
          adverts (kind <code>30078</code>, <code>d=fips-overlay-v1</code>) and
          lists every node currently announcing itself.
        </p>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <!-- Compact control bar. Filters collapse by default; the hero CTA is
             the "Scan" button so visitors land on live data immediately. -->
        <div class="bar">
          <div class="bar-left">
            <span class="eyebrow">results</span>
            <div class="stats">
              <span class="pill accent-green">
                <span class="pill-k">live</span>
                <span class="pill-v">{{ liveCount }}</span>
              </span>
              <span class="pill accent-red">
                <span class="pill-k">expired</span>
                <span class="pill-v">{{ expiredCount }}</span>
              </span>
              <span class="pill">
                <span class="pill-k">relays</span>
                <span class="pill-v">{{ relayUrls.length }}</span>
              </span>
              <span class="pill" :class="statusPillClass(status)">
                <span class="pill-k">status</span>
                <span class="pill-v">{{ status }}</span>
              </span>
            </div>
          </div>
          <div class="bar-actions">
            <button
              class="secondary"
              :aria-expanded="filtersOpen"
              @click="filtersOpen = !filtersOpen"
            >
              <span>Filters</span>
              <svg
                :class="{ open: filtersOpen }"
                viewBox="0 0 24 24"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button :disabled="isScanning" @click="scan">
              {{ isScanning ? "Scanning…" : "Scan" }}
            </button>
            <button :disabled="!isScanning" class="secondary" @click="stop">
              Stop
            </button>
          </div>
        </div>

        <div v-if="filtersOpen" class="panel">
          <div class="panel-head">
            <div>
              <span class="eyebrow">relays</span>
              <p class="panel-hint">
                FIPS nodes publish to <code>wss://offchain.pub</code> and
                <code>wss://strfry.bitsbytom.com</code> by default. Adverts
                carry a <code>~1 h</code> NIP-40 expiration — well-behaved
                relays drop them afterward, so offline peers can be invisible.
              </p>
            </div>
            <button class="secondary tiny" @click="resetRelays">
              reset defaults
            </button>
          </div>
          <textarea
            v-model="relaysText"
            spellcheck="false"
            aria-label="Relays, one per line"
          />

          <div class="controls-row">
            <div class="field">
              <label>Protocol filter</label>
              <input
                v-model="protocolFilter"
                type="text"
                placeholder="fips-overlay-v1"
              />
            </div>
            <div class="field">
              <label>Lookback (days)</label>
              <input v-model.number="sinceDays" type="number" min="0" step="1" />
            </div>
            <div class="field">
              <label>Limit per relay</label>
              <input
                v-model.number="limit"
                type="number"
                min="0"
                step="100"
              />
            </div>
          </div>

          <div class="toggles">
            <label>
              <input v-model="useDTag" type="checkbox" />
              <span>
                use <code>#d</code> relay-side filter
                <span class="muted">(off = broader, but slower)</span>
              </span>
            </label>
            <label>
              <input v-model="showExpired" type="checkbox" />
              <span>show expired (offline) peers</span>
            </label>
          </div>
        </div>

        <div v-if="peerList.length === 0" class="empty">
          <span class="eyebrow">no peers yet</span>
          <p>
            {{
              status === "scanning…" || status === "live"
                ? "Scanning relays… if nothing appears, try a longer lookback, disable #d filtering, or add more relays."
                : 'Click "Scan" to query the default relays.'
            }}
          </p>
        </div>
        <div v-else class="table-wrap">
          <table class="peers-table">
            <thead>
              <tr>
                <th class="col-status"></th>
                <th class="col-pubkey">pubkey</th>
                <th class="col-endpoints">endpoints</th>
                <th class="col-proto">protocol</th>
                <th class="col-relays">relays</th>
                <th class="col-time">created</th>
                <th class="col-expires">expires</th>
                <th class="col-caret"></th>
              </tr>
            </thead>
            <tbody>
              <PeerCard
                v-for="{ event, advert } in peerList"
                :key="event.pubkey"
                :event="event"
                :advert="advert"
                :now-sec="nowSec"
              />
            </tbody>
          </table>
        </div>

        <div v-if="errorMsg" class="err">{{ errorMsg }}</div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container">
      <div class="footer-brand">
        <span class="footer-logo">FIPS</span>
        <span class="footer-domain">fips.network</span>
      </div>
      <div class="footer-note">
        No tracking. No analytics. No cookies. All queries run in your browser.
      </div>
    </div>
  </footer>
</template>

<style scoped>
.container {
  max-width: var(--content-wide-max-width);
  margin: 0 auto;
  padding: 0 var(--space-lg);
}

/* Header ---------------------------------------------------------------- */
.site-header {
  border-bottom: 1px solid var(--border-subtle);
  padding: var(--space-md) 0;
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(13, 17, 23, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.site-header > .container {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
}
.logo {
  display: flex;
  flex-direction: column;
  line-height: 1;
  color: var(--text-primary);
  text-decoration: none;
}
.logo-text {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.logo:hover .logo-text {
  color: var(--color-app-border);
}
.logo-sub {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin-top: 1px;
}
.main-nav {
  display: flex;
  gap: var(--space-lg);
  flex: 1;
  justify-content: center;
}
.main-nav a {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--text-muted);
  transition: color 0.2s;
}
.main-nav a:hover {
  color: var(--text-primary);
  text-decoration: none;
}
.header-actions {
  display: flex;
  gap: var(--space-sm);
}
.action-link {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--text-secondary);
  padding: 5px 12px;
  border-radius: 5px;
  border: 1px solid transparent;
  transition: all 0.15s;
}
.action-link:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--border-subtle);
  text-decoration: none;
}
.action-link.bordered {
  border-color: var(--border-subtle);
}

/* Hero ------------------------------------------------------------------ */
.hero {
  padding: calc(var(--space-xl) + var(--space-md)) 0 var(--space-xl);
}
.hero-title {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: clamp(2.5rem, 6vw, 4.25rem);
  letter-spacing: -0.02em;
  margin: var(--space-sm) 0 var(--space-md);
  line-height: 1;
}
.hero-tagline {
  color: var(--text-secondary);
  max-width: 640px;
  font-size: 1rem;
  line-height: 1.6;
  margin: 0;
}

/* Sections -------------------------------------------------------------- */
.section {
  padding-bottom: calc(var(--space-xl) + var(--space-lg));
}

/* Panel (controls) ------------------------------------------------------ */
.panel {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  padding: var(--space-lg);
  margin-bottom: var(--space-lg);
}
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
}
.panel-head > div {
  flex: 1;
}
.panel-hint {
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin: var(--space-sm) 0 0;
  line-height: 1.55;
  max-width: 640px;
}
.panel-hint code {
  font-size: 0.8125rem;
}
button.tiny {
  padding: 5px 11px;
  font-size: 0.6875rem;
  font-weight: 500;
}

.controls-row {
  display: flex;
  gap: var(--space-md);
  align-items: flex-end;
  margin-top: var(--space-md);
  flex-wrap: wrap;
}
.field {
  flex: 1;
  min-width: 180px;
}
.field label {
  display: block;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.field input {
  width: 100%;
}
.actions {
  flex: 0 0 auto;
  display: flex;
  gap: var(--space-sm);
}

.toggles {
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  gap: var(--space-lg);
  flex-wrap: wrap;
}
.toggles label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  cursor: pointer;
}
.toggles input[type="checkbox"] {
  accent-color: var(--color-app-border);
  width: 14px;
  height: 14px;
  padding: 0;
}
.toggles .muted {
  color: var(--text-muted);
}

/* Results bar ----------------------------------------------------------- */
.bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
  flex-wrap: wrap;
}
.bar-left {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bar-actions {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  flex-shrink: 0;
}
.bar-actions button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.bar-actions svg {
  transition: transform 0.2s ease;
}
.bar-actions svg.open {
  transform: rotate(180deg);
}
.stats {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.stats .pill {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.stats .pill-k {
  color: var(--text-muted);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.stats .pill-v {
  color: var(--text-primary);
  font-weight: 500;
}
.stats .pill.accent-green {
  color: var(--color-app-border);
  border-color: var(--color-app-border);
  background: rgba(64, 160, 96, 0.08);
}
.stats .pill.accent-green .pill-v {
  color: var(--color-app-border);
}
.stats .pill.accent-red {
  color: var(--color-transport-border);
  border-color: var(--color-transport-border);
  background: rgba(192, 96, 64, 0.08);
}
.stats .pill.accent-red .pill-v {
  color: var(--color-transport-border);
}

/* Peer table ------------------------------------------------------------ */
.table-wrap {
  width: 100%;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-surface);
  overflow: hidden;
}
.peers-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}
.peers-table thead tr {
  background: var(--bg-surface-alt);
}
.peers-table thead th {
  text-align: left;
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
}
.peers-table .col-status {
  width: 28px;
}
.peers-table .col-caret {
  width: 28px;
  text-align: right;
}
.peers-table .col-relays,
.peers-table .col-time,
.peers-table .col-expires {
  width: 1%;
  white-space: nowrap;
}

.empty {
  padding: var(--space-xl) var(--space-lg);
  text-align: center;
  color: var(--text-muted);
  border: 1px dashed var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-surface-alt);
}
.empty .eyebrow {
  justify-content: center;
  margin-bottom: var(--space-sm);
}
.empty p {
  margin: var(--space-sm) auto 0;
  max-width: 480px;
  font-size: 0.875rem;
  line-height: 1.55;
}
.err {
  color: var(--color-transport-border);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  margin-top: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--color-transport-border);
  background: var(--color-transport);
  border-radius: 5px;
}

/* Footer ---------------------------------------------------------------- */
.site-footer {
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  padding: var(--space-lg) 0;
  margin-top: var(--space-xl);
}
.site-footer .container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-md);
  flex-wrap: wrap;
}
.footer-brand {
  display: flex;
  flex-direction: column;
  line-height: 1;
}
.footer-logo {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 1rem;
}
.footer-domain {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: var(--text-muted);
  letter-spacing: 0.05em;
  margin-top: 2px;
}
.footer-note {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

/* Mobile ---------------------------------------------------------------- */
@media (max-width: 768px) {
  .site-header > .container {
    gap: var(--space-md);
  }
  .main-nav {
    display: none;
  }
  .panel-head {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
