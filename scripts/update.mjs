import fs from "fs";

const BASE = "https://pc28.help";
const STATE_FILE = "data/state.json";
const combosAll = ["大单", "大双", "小单", "小双"];

const SIM_START = 300;
const SIM_TARGET = 500;
const SIM_BASE = 5;
const MIN_CONF = 58;

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function getJson(path) {
  const res = await fetch(BASE + path, {
    headers: {
      "user-agent": "Mozilla/5.0 jnd28-background-updater"
    }
  });

  if (!res.ok) {
    throw new Error(`${path} HTTP ${res.status}`);
  }

  return await res.json();
}

function classify(sum) {
  return (sum <= 13 ? "小" : "大") +
         (sum % 2 === 0 ? "双" : "单");
}

function normalizeCombo(value) {
  const str = String(value || "").replace(/\s+/g, "");
  return combosAll.find(x => str.includes(x)) || null;
}

/* Keno 20号码 → PC28 和值 */
function calcFromKeno(nbrs) {
  const nums = String(nbrs || "")
    .split(",")
    .map(Number);

  if (nums.length < 20) return null;

  const a =
    [1, 4, 7, 10, 13, 16]
      .reduce((s, i) => s + nums[i], 0) % 10;

  const b =
    [2, 5, 8, 11, 14, 17]
      .reduce((s, i) => s + nums[i], 0) % 10;

  const c =
    [3, 6, 9, 12, 15, 18]
      .reduce((s, i) => s + nums[i], 0) % 10;

  return {
    a,
    b,
    c,
    sum: a + b + c
  };
}

/* 优先使用 /api/kj，失败或为空时用 /api/keno */
async function loadDrawRows() {
  try {
    const kj = await getJson("/api/kj.json?nbr=100");

    if (
      Array.isArray(kj.data) &&
      kj.data.length > 0
    ) {
      return {
        source: "kj",
        raw: kj,
        rows: kj.data.map((r, i) => ({
          issue: String(r.nbr || ""),
          sum: Number(r.number),
          combo:
            r.combination ||
            classify(Number(r.number)),
          idx: i
        }))
        .filter(r =>
          r.issue &&
          Number.isFinite(r.sum)
        )
      };
    }
  } catch (e) {
    console.log(
      "KJ接口不可用，切换Keno：",
      e.message
    );
  }

  const keno =
    await getJson(
      "/api/keno.json?nbr=100"
    );

  if (
    !Array.isArray(keno.data) ||
    !keno.data.length
  ) {
    throw new Error(
      "KJ与Keno接口都没有数据"
    );
  }

  const rows = [];

  for (
    const [i, r]
    of keno.data.entries()
  ) {
    const pc = calcFromKeno(r.nbrs);

    if (!pc) continue;

    rows.push({
      issue: String(r.nbr || ""),
      sum: pc.sum,
      combo: classify(pc.sum),
      a: pc.a,
      b: pc.b,
      c: pc.c,
      idx: i
    });
  }

  if (!rows.length) {
    throw new Error(
      "Keno数据无法计算PC28"
    );
  }

  return {
    source: "keno",
    raw: keno,
    rows
  };
}

/* 算法一 */
function algo1(
  rows,
  sz,
  sha
) {
  rows = rows.slice(0, 100);

  const primary =
    normalizeCombo(
      sz?.data?.[0]?.predict
    ) ||
    rows[0]?.combo ||
    "大单";

  const kill =
    normalizeCombo(
      sha?.data?.[0]?.predict
    ) || null;

  const counts =
    Object.fromEntries(
      combosAll.map(c => [c, 0])
    );

  rows.forEach(r =>
    counts[r.combo]++
  );

  let candidates =
    combosAll.filter(
      c =>
        c !== primary &&
        c !== kill
    );

  if (!candidates.length) {
    candidates =
      combosAll.filter(
        c => c !== primary
      );
  }

  candidates.sort(
    (a, b) =>
      counts[b] - counts[a]
  );

  const second =
    candidates[0];

  let confidence = 52;

  if (
    kill &&
    kill !== primary &&
    kill !== second
  ) {
    confidence += 10;
  }

  const topFreq =
    Math.max(
      counts[primary] || 0,
      counts[second] || 0
    );

  confidence +=
    Math.min(
      18,
      Math.round(
        topFreq /
        Math.max(1, rows.length) *
        40
      )
    );

  return {
    combos: [
      primary,
      second
    ],

    kill:
      kill ||
      combosAll.find(
        c =>
          ![
            primary,
            second
          ].includes(c)
      ),

    confidence:
      Math.min(
        85,
        confidence
      )
  };
}

/* 算法二：近期趋势+转移 */
function algo2(rows) {
  rows = rows.slice(0, 36);

  const score =
    Object.fromEntries(
      combosAll.map(
        c => [c, 0]
      )
    );

  const transitions = {};

  rows.forEach((r, i) => {
    const weight =
      Math.max(
        0.25,
        1 - i * 0.024
      );

    score[r.combo] += weight;

    if (i + 1 < rows.length) {
      const previous =
        rows[i + 1].combo;

      transitions[previous] ||=
        Object.fromEntries(
          combosAll.map(
            c => [c, 0]
          )
        );

      transitions[previous][r.combo]
        += weight;
    }
  });

  const latest =
    rows[0]?.combo;

  const trans =
    latest &&
    transitions[latest]
      ? transitions[latest]
      : {};

  const rank =
    combosAll
      .map(c => ({
        c,
        s:
          score[c] +
          (trans[c] || 0) *
          1.35
      }))
      .sort(
        (a, b) =>
          b.s - a.s
      );

  const total =
    rank.reduce(
      (s, x) => s + x.s,
      0
    ) || 1;

  return {
    combos: [
      rank[0].c,
      rank[1].c
    ],

    kill:
      rank[
        rank.length - 1
      ].c,

    confidence:
      Math.min(
        88,
        Math.round(
          (
            rank[0].s +
            rank[1].s
          ) /
          total *
          100
        )
      )
  };
}

/* 算法三：20/50/100综合 */
function algo3(rows) {
  rows = rows.slice(0, 100);

  const windows =
    [20, 50, 100];

  const blended =
    Object.fromEntries(
      combosAll.map(
        c => [c, 0]
      )
    );

  for (
    const [wi, size]
    of windows.entries()
  ) {
    const part =
      rows.slice(0, size);

    const counts =
      Object.fromEntries(
        combosAll.map(
          c => [c, 0]
        )
      );

    part.forEach(
      r =>
        counts[r.combo]++
    );

    const weight =
      [0.25, 0.30, 0.45][wi];

    combosAll.forEach(c => {
      blended[c] +=
        counts[c] /
        Math.max(
          1,
          part.length
        ) *
        weight;
    });
  }

  const recent =
    rows
      .slice(0, 5)
      .map(r => r.combo);

  combosAll.forEach(c => {
    const count =
      recent.filter(
        x => x === c
      ).length;

    blended[c] -=
      count * 0.008;
  });

  const rank =
    combosAll
      .map(c => ({
        c,
        s: blended[c]
      }))
      .sort(
        (a, b) =>
          b.s - a.s
      );

  const total =
    rank.reduce(
      (s, x) => s + x.s,
      0
    ) || 1;

  return {
    combos: [
      rank[0].c,
      rank[1].c
    ],

    kill:
      rank[
        rank.length - 1
      ].c,

    confidence:
      Math.min(
        86,
        Math.round(
          (
            rank[0].s +
            rank[1].s
          ) /
          total *
          100
        )
      )
  };
}

function settleRecord(
  algoState,
  actual
) {
  const current =
    algoState.current;

  if (
    !current ||
    current.issue !==
      actual.issue
  ) {
    return;
  }

  const comboHit =
    current.combos.includes(
      actual.combo
    );

  const killSuccess =
    current.kill
      ? actual.combo !==
        current.kill
      : null;

  algoState.records.unshift({
    issue:
      actual.issue,

    combos:
      current.combos,

    kill:
      current.kill,

    confidence:
      current.confidence,

    actualCombo:
      actual.combo,

    actualSum:
      actual.sum,

    comboHit,
    killSuccess,

    settledAt:
      new Date()
        .toISOString()
  });

  algoState.records =
    algoState.records
      .slice(0, 100);

  algoState.current = null;
}

function settleSim(
  sim,
  actual
) {
  const pending =
    sim.pending;

  if (
    !pending ||
    pending.issue !==
      actual.issue
  ) {
    return;
  }

  const hit =
    pending.combos.includes(
      actual.combo
    );

  if (hit) {
    sim.points +=
      sim.stake;

    sim.net +=
      sim.stake;

    sim.step = 1;
    sim.stake = SIM_BASE;
  } else {
    const loss =
      sim.stake * 2;

    sim.points -= loss;
    sim.net -= loss;

    sim.step += 1;
    sim.stake *= 2;
  }

  sim.pending = null;

  if (
    sim.points >=
    SIM_TARGET
  ) {
    sim.success++;

    sim.history.unshift({
      round:
        sim.round,

      result:
        "成功",

      endPoints:
        sim.points,

      endedAt:
        new Date()
          .toISOString()
    });

    sim.round++;
    sim.points =
      SIM_START;

    sim.step = 1;
    sim.stake =
      SIM_BASE;

  } else if (
    sim.points <= 0 ||
    sim.points <
      sim.stake * 2
  ) {
    sim.fail++;

    sim.history.unshift({
      round:
        sim.round,

      result:
        "失败",

      endPoints:
        Math.max(
          0,
          sim.points
        ),

      endedAt:
        new Date()
          .toISOString()
    });

    sim.round++;
    sim.points =
      SIM_START;

    sim.step = 1;
    sim.stake =
      SIM_BASE;
  }

  sim.history =
    sim.history
      .slice(0, 100);
}

function ensurePrediction(
  algoState,
  sim,
  issue,
  prediction
) {
  if (
    !algoState.current ||
    algoState.current.issue
      !== issue
  ) {
    algoState.current = {
      issue,
      ...prediction,
      createdAt:
        new Date()
          .toISOString()
    };
  }

  if (
    !sim.pending &&
    prediction.confidence
      >= MIN_CONF
  ) {
    sim.pending = {
      issue,

      combos: [
        ...prediction.combos
      ],

      confidence:
        prediction.confidence,

      createdAt:
        new Date()
          .toISOString()
    };
  }
}

async function tick() {
  const state =
    loadState();

  const drawData =
    await loadDrawRows();

  const rows =
    drawData.rows;

  const latest =
    rows[0];

  console.log(
    "开奖数据源:",
    drawData.source
  );

  state.latestDraw = {
    issue:
      latest.issue,

    sum:
      latest.sum,

    combo:
      latest.combo
  };

  state.nextIssue =
    String(
      Number(
        latest.issue
      ) + 1
    );

  for (
    const id of
    ["a1", "a2", "a3"]
  ) {
    settleRecord(
      state.algorithms[id],
      latest
    );

    settleSim(
      state.simulations[id],
      latest
    );
  }

  let sz = {};
  let sha = {};

  try {
    sz =
      await getJson(
        "/api/sz.json?nbr=1"
      );
  } catch {}

  try {
    sha =
      await getJson(
        "/api/sha.json?nbr=1"
      );
  } catch {}

  const p1 =
    algo1(
      rows,
      sz,
      sha
    );

  const p2 =
    algo2(rows);

  const p3 =
    algo3(rows);

  ensurePrediction(
    state.algorithms.a1,
    state.simulations.a1,
    state.nextIssue,
    p1
  );

  ensurePrediction(
    state.algorithms.a2,
    state.simulations.a2,
    state.nextIssue,
    p2
  );

  ensurePrediction(
    state.algorithms.a3,
    state.simulations.a3,
    state.nextIssue,
    p3
  );

  saveState(state);

  console.log(
    `updated ${latest.issue} -> ${state.nextIssue}`
  );
}

const loops =
  Number(
    process.env
      .POLL_LOOPS || 1
  );

const sleepMs =
  Number(
    process.env
      .POLL_INTERVAL_MS || 0
  );

let successCount = 0;

for (
  let i = 0;
  i < loops;
  i++
) {
  try {
    await tick();
    successCount++;
  } catch (error) {
    console.error(
      "本轮更新失败:",
      error.message
    );
  }

  if (
    i < loops - 1 &&
    sleepMs > 0
  ) {
    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          sleepMs
        )
    );
  }
}

if (
  successCount === 0
) {
  process.exitCode = 1;
}
