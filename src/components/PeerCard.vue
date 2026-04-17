<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  event: { type: Object, required: true },
  advert: { type: Object, default: null },
  nowSec: { type: Number, required: true },
});

const expanded = ref(false);

function tagValue(ev, name) {
  const t = ev.tags.find((x) => x[0] === name);
  return t ? t[1] : null;
}

const protocol = computed(
  () => tagValue(props.event, "protocol") || "(missing)",
);
const versionTag = computed(() => tagValue(props.event, "version") || "?");
const expiration = computed(() => {
  const v = tagValue(props.event, "expiration");
  return v ? Number(v) : null;
});
const isExpired = computed(() => {
  const e = expiration.value;
  return e !== null && e < props.nowSec;
});

const endpoints = computed(() => props.advert?.endpoints || []);
const signalRelays = computed(() => props.advert?.signalRelays || []);
const stunServers = computed(() => props.advert?.stunServers || []);
const hasUdpNat = computed(() => endpoints.value.some(isUdpNat));

function shortPubkey(hex) {
  return hex.slice(0, 10) + "…" + hex.slice(-6);
}

function formatUnix(ts) {
  if (!ts) return null;
  return new Date(ts * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", "Z");
}

function relativeTime(ts) {
  if (!ts) return "";
  const diff = props.nowSec - ts;
  const abs = Math.abs(diff);
  const unit =
    abs < 60
      ? `${abs}s`
      : abs < 3600
        ? `${Math.floor(abs / 60)}m`
        : abs < 86400
          ? `${Math.floor(abs / 3600)}h`
          : `${Math.floor(abs / 86400)}d`;
  return diff >= 0 ? `${unit} ago` : `in ${unit}`;
}

function isUdpNat(endpoint) {
  return (
    endpoint.transport === "udp" &&
    String(endpoint.addr).toLowerCase() === "nat"
  );
}

const rawJson = computed(() => JSON.stringify(props.event, null, 2));
</script>

<template>
  <tr
    class="summary"
    :class="{ 'is-expired': isExpired, 'is-open': expanded }"
    @click="expanded = !expanded"
  >
    <td class="col-status">
      <span class="status-dot" :class="{ offline: isExpired }" />
    </td>
    <td class="col-pubkey">
      <span class="short mono">{{ shortPubkey(event.pubkey) }}</span>
    </td>
    <td class="col-endpoints">
      <template v-if="endpoints.length">
        <span
          v-for="e in endpoints"
          :key="`${e.transport}:${e.addr}`"
          class="tag"
          :class="{ 'accent-green': isUdpNat(e) }"
          >{{ e.transport }}:{{ e.addr }}</span
        >
      </template>
      <span v-else class="tag muted-tag">none</span>
    </td>
    <td class="col-proto">
      <span class="tag accent-purple">{{ protocol }}</span
      ><span class="tag">v{{ versionTag }}</span>
    </td>
    <td class="col-relays mono">{{ signalRelays.length || "—" }}</td>
    <td class="col-time mono">
      <span>{{ relativeTime(event.created_at) }}</span>
    </td>
    <td class="col-expires mono">
      <template v-if="expiration">
        <span v-if="isExpired" class="tag accent-red">expired</span>
        <span v-else>{{ relativeTime(expiration) }}</span>
      </template>
      <span v-else class="muted">—</span>
    </td>
    <td class="col-caret">
      <svg
        :class="{ open: expanded }"
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </td>
  </tr>
  <tr v-if="expanded" class="detail">
    <td colspan="8">
      <dl class="meta">
        <div class="meta-row">
          <dt>pubkey</dt>
          <dd class="mono">{{ event.pubkey }}</dd>
        </div>
        <div v-if="hasUdpNat" class="meta-row">
          <dt>discovery</dt>
          <dd>
            <span class="tag accent-green">udp:nat</span>
            <span class="muted"
              >— reachable via Nostr-signaled hole-punching</span
            >
          </dd>
        </div>
        <div v-if="signalRelays.length" class="meta-row">
          <dt>signal relays</dt>
          <dd>
            <span v-for="r in signalRelays" :key="r" class="tag">{{ r }}</span>
          </dd>
        </div>
        <div v-if="stunServers.length" class="meta-row">
          <dt>stun servers</dt>
          <dd>
            <span v-for="s in stunServers" :key="s" class="tag">{{ s }}</span>
          </dd>
        </div>
        <div class="meta-row">
          <dt>created</dt>
          <dd class="mono muted">
            {{ formatUnix(event.created_at) }}
            <span class="rel">({{ relativeTime(event.created_at) }})</span>
          </dd>
        </div>
        <div v-if="expiration" class="meta-row">
          <dt>expires</dt>
          <dd class="mono muted">
            {{ formatUnix(expiration) }}
            <span class="rel">({{ relativeTime(expiration) }})</span>
          </dd>
        </div>
      </dl>
      <details class="raw">
        <summary>raw event</summary>
        <pre>{{ rawJson }}</pre>
      </details>
    </td>
  </tr>
</template>

<style scoped>
tr.summary {
  cursor: pointer;
  transition: background-color 0.12s ease;
}
tr.summary:hover {
  background: rgba(255, 255, 255, 0.02);
}
tr.summary.is-open {
  background: rgba(255, 255, 255, 0.03);
}
tr.summary.is-expired {
  opacity: 0.55;
}
tr.summary td {
  border-top: 1px solid var(--border-subtle);
  padding: 10px 12px;
  vertical-align: middle;
  font-size: 0.8125rem;
}

.col-status {
  width: 28px;
}
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-app-border);
  box-shadow: 0 0 8px var(--color-app-border);
}
.status-dot.offline {
  background: var(--color-transport-border);
  box-shadow: 0 0 6px var(--color-transport-border);
}

.col-pubkey {
  max-width: 180px;
}
.short {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-primary);
}

.col-endpoints {
  max-width: 260px;
}
.col-proto {
  max-width: 220px;
}
.col-relays,
.col-time,
.col-expires {
  color: var(--text-secondary);
  white-space: nowrap;
  font-size: 0.75rem;
}
.col-caret {
  width: 28px;
  color: var(--text-muted);
  text-align: right;
}
.col-caret svg {
  transition: transform 0.2s ease;
}
.col-caret svg.open {
  transform: rotate(180deg);
}

.muted-tag {
  color: var(--text-muted);
}
.muted {
  color: var(--text-muted);
}

tr.detail td {
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-surface-alt);
  border-top: 1px solid var(--border-subtle);
}
.meta {
  margin: 0 0 var(--space-md);
  display: grid;
  gap: 4px;
}
.meta-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: var(--space-md);
  align-items: baseline;
  padding: 4px 0;
}
.meta-row dt {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}
.meta-row dd {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.8125rem;
  word-break: break-word;
}
.meta-row dd.mono {
  font-family: var(--font-mono);
}
.meta-row dd.muted {
  color: var(--text-secondary);
}
.rel {
  color: var(--text-muted);
}

.raw {
  margin-top: var(--space-sm);
}
.raw summary {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}
.raw summary:hover {
  color: var(--text-secondary);
}
.raw pre {
  margin: var(--space-sm) 0 0;
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-page);
  border: 1px solid var(--border-subtle);
  border-radius: 5px;
  font-size: 0.6875rem;
  color: var(--text-secondary);
  overflow: auto;
  max-height: 320px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .col-relays,
  .col-time {
    display: none;
  }
}
@media (max-width: 640px) {
  .col-proto,
  .col-expires {
    display: none;
  }
  .meta-row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}
</style>
