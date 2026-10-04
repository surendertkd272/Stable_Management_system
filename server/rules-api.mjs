// /api/rules — the alert rules staff set themselves (server/staff-rules.mjs).
// Staff and admins make rules; a staff member changes or deletes their own,
// an admin any. Owners do not see them.
import { MEASURES, validateRule, backtest, judgeRule, ruleText, configureStaffRules } from "./staff-rules.mjs";

const KIND = "rules";

export function rulesApi({ store, json, roster }) {
  const refresh = () => configureStaffRules(store.list(KIND));
  refresh();
  const actor = (who) => who?.username || who?.name || "admin";
  const mayChange = (who, rule) => !who || who.role === "admin" || rule.createdBy === actor(who);
  const horseName = (id) => (id === "*" ? "All horses" : roster().find((h) => h.id === id)?.name ?? id);
  const readingsFor = (rule) => (rule.horse === "*" ? roster().map((h) => [h, store.readingsForHorse(h.id)]) : [[roster().find((h) => h.id === rule.horse), store.readingsForHorse(rule.horse)]])
    .filter(([h]) => h);
  /** The rule as the page shows it: in words, and whether it holds now. */
  const view = (rule, now = Date.now()) => {
    const firing = readingsFor(rule).filter(([, rd]) => rule.enabled && judgeRule(rule, rd, now).fires).map(([h]) => h.name);
    return { ...rule, horseName: horseName(rule.horse), text: ruleText(rule), firingNow: firing };
  };
  const body = async (req) => { try { return JSON.parse((await req.text()) || "{}"); } catch { return null; } };

  async function handle(req, url, who) {
    const path = url.pathname, method = req.method;
    if (!path.startsWith("/api/rules")) return null;
    if (who?.role === "owner") return json(404, { error: "not found" });

    if (path === "/api/rules" && method === "GET")
      return json(200, {
        rules: store.list(KIND).map((r) => view(r)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        measures: Object.entries(MEASURES).map(([key, m]) => ({ key, label: m.label, unit: m.unit, kind: m.kind, max: m.max })),
      });

    // Try a rule before saving it: how often it would have fired in the last 7 days.
    if (path === "/api/rules/test" && method === "POST") {
      const b = await body(req);
      if (!b) return json(400, { error: "malformed JSON" });
      const { rule, errors } = validateRule(b, { horses: roster() });
      if (errors) return json(400, { error: errors[0], errors });
      const per = readingsFor(rule).map(([h, rd]) => ({ horse: h.name, now: judgeRule(rule, rd), week: backtest(rule, rd) }));
      return json(200, { text: ruleText(rule), name: rule.name, horses: per });
    }

    if (path === "/api/rules" && method === "POST") {
      const b = await body(req);
      if (!b) return json(400, { error: "malformed JSON" });
      const { rule, errors } = validateRule(b, { horses: roster() });
      if (errors) return json(400, { error: errors[0], errors });
      const row = store.create(KIND, { ...rule, createdBy: actor(who), createdAt: new Date().toISOString() });
      refresh();
      return json(201, view(row));
    }

    const one = path.match(/^\/api\/rules\/([^/]+)$/);
    if (one) {
      const cur = store.list(KIND).find((r) => r.id === decodeURIComponent(one[1]));
      if (!cur) return json(404, { error: "no such rule" });
      if ((method === "PATCH" || method === "DELETE") && !mayChange(who, cur))
        return json(403, { error: `only ${cur.createdBy} or an administrator can change this rule` });
      if (method === "PATCH") {
        const b = await body(req);
        if (!b) return json(400, { error: "malformed JSON" });
        const { rule, errors } = validateRule(b, { horses: roster(), existing: cur });
        if (errors) return json(400, { error: errors[0], errors });
        const row = store.update(KIND, cur.id, { ...rule, changedBy: actor(who), changedAt: new Date().toISOString() });
        refresh();
        return json(200, view(row));
      }
      if (method === "DELETE") {
        store.remove(KIND, cur.id);
        refresh();
        return json(200, { ok: true });
      }
    }
    return json(405, { error: "method not allowed" });
  }
  return { handle, refresh };
}
