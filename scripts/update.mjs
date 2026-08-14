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
      "user-agent": "jnd28-background-updater/1.0"
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

function getRows(kj) {
  return (kj.data || [])
    .map((r, i) => ({
      issue: String(r.nbr || ""),
      sum: Number(r.number),
      combo: r.combination || classify(Number(r.number)),
      idx: i
    }))
    .filter(r => Number.isFinite(r.sum) && r.issue);
}

/* 算法一：接口预测 + 历史校正 */
function algo1(kj, sz, sha) {
  const rows = getRows(kj).slice(0, 100);

  const primary =
    normalizeCombo(sz?.data?.[0]?.predict) ||
    rows[0]?.combo ||
    "大单";

  const kill =
    normalizeCombo(sha?.data?.[0]?.predict) || null;

  const counts =
    Object.fromEntries(combosAll.map(c => [c, 0]));

  rows.forEach(r => counts[r.combo]++);

  let candidates =
    combosAll.filter(c => c !== primary && c !== kill);

  if (!candidates.length) {
    candidates =
      combosAll.filter(c => c !== primary);
  }

  candidates.sort(
    (a, b) => counts[b] - counts[a]
  );

  const second = candidates[0];

  let confidence = 52;

  if (
    kill &&
    kill !== primary &&
    kill !== second
  ) {
    confidence += 10;
  }

  const topFreq = Math.max(
    counts[primary] || 0,
    counts[second] || 0
  );

  confidence += Math.min(
    18,
    Math.round(
      topFreq /
      Math.max(1, rows.length) *
      40
    )
  );

  return {
    combos: [primary, second],
    kill:
      kill ||
      combosAll.find(
        c => ![primary, second].includes(c)
      ),
    confidence: Math.min(85, confidence)
  };
}

/* 算法二：近期结构 + 转移关系 */
function algo2(kj) {
  const rows = getRows(kj).slice(0, 36);

  const score =
    Object.fromEntries(
      combosAll.map(c => [c, 0])
    );

  const transitions = {};

  rows.forEach((r, i) => {
    const weight =
      Math.max(0.25, 1 - i * 0.024);

    score[r.combo] += weight;

    if (i + 1 < rows.length) {
      const previous =
        rows[i + 1].combo;

      const current =
        r.combo;

      transitions[previous] ||=
        Object.fromEntries(
          combosAll.map(c => [c, 0])
        );

      transitions[previous][current] +=
        weight;
    }
  });

  const latest = rows[0]?.combo;

  const trans =
    latest && transitions[latest]
      ? transitions[latest]
      : {};

  const rank =
    combosAll
      .map(c => ({
        c,
        s:
          score[c] +
          (trans[c] || 0) * 1.35
      }))
      .sort((a, b) => b.s - a.s);

  const total =
    rank.reduce(
      (sum, x) => sum + x.s,
      0
    ) || 1;

  return {
    combos: [
      rank[0].c,
      rank[1].c
    ],

    kill:
      rank[rank.length - 1].c,

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

/* 算法三：20 / 50 / 100期综合 */
function algo3(kj) {
  const rows =
    getRows(kj).slice(0, 100);

  const windows =
    [20, 50, 100];

  const blended =
    Object.fromEntries(
      combosAll.map(c => [c, 0])
    );

  for (
    const [wi, windowSize]
    of windows.entries()
  ) {
    const part =
      rows.slice(0, windowSize);

    const counts =
      Object.fromEntries(
        combosAll.map(c => [c, 0])
      );

    part.forEach(
      r => counts[r.combo]++
    );

    const weight =
      [0.25, 0.30, 0.45][wi];

    combosAll.forEach(c => {
      blended[c] +=
        counts[c] /
        Math.max(1, part.length) *
        weight;
    });
  }

  const recent =
    rows.slice(0, 5)
        .map(r => r.combo);

  combosAll.forEach(c => {
    const recentCount =
      recent.filter(x => x === c)
            .length;

    blended[c] -=
      recentCount * 0.008;
  });

  const rank =
    combosAll
      .map(c => ({
        c,
        s: blended[c]
      }))
      .sort((a, b) => b.s - a.s);

  const total =
    rank.reduce(
      (sum, x) => sum + x.s,
      0
    ) || 1;

  return {
    combos: [
      rank[0].c,
      rank[1].c
    ],

    kill:
      rank[rank.length - 1].c,

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

/* 核对预测 */
function settleRecord(
  algoState,
  actual
) {
  const current =
    algoState.current;

  if (
    !current ||
    current.issue !== actual.issue
  ) {
    return;
  }

  const comboHit =
    current.combos.includes(
      actual.combo
    );

  const killSuccess =
    current.kill
      ? actual.combo !== current.kill
      : null;

  algoState.records.unshift({
    issue: actual.issue,
    combos: current.combos,
    kill: current.kill,
    confidence: current.confidence,
    actualCombo: actual.combo,
    actualSum: actual.sum,
    comboHit,
    killSuccess,
    settledAt:
      new Date().toISOString()
  });

  algoState.records =
    algoState.records.slice(0, 100);

  algoState.current = null;
}

/* 虚拟积分结算 */
function settleSim(sim, actual) {
  const pending = sim.pending;

  if (
    !pending ||
    pending.issue !== actual.issue
  ) {
    return;
  }

  const hit =
    pending.combos.includes(
      actual.combo
    );

  if (hit) {
    sim.points += sim.stake;
    sim.net += sim.stake;

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

  if (sim.points >= SIM_TARGET) {
    sim.success++;

    sim.history.unshift({
      round: sim.round,
      result: "成功",
      endPoints: sim.points,
      endedAt:
        new Date().toISOString()
    });

    sim.round++;
    sim.points = SIM_START;
    sim.step = 1;
    sim.stake = SIM_BASE;
  } else if (
    sim.points <= 0 ||
    sim.points < sim.stake * 2
  ) {
    sim.fail++;

    sim.history.unshift({
      round: sim.round,
      result: "失败",
      endPoints:
        Math.max(0, sim.points),
      endedAt:
        new Date().toISOString()
    });

    sim.round++;
    sim.points = SIM_START;
    sim.step = 1;
    sim.stake = SIM_BASE;
  }

  sim.history =
    sim.history.slice(0, 100);
}

/* 创建下一期预测 */
function ensurePrediction(
  algoState,
  sim,
  issue,
  prediction
) {
  if (
    !algoState.current ||
    algoState.current.issue !== issue
  ) {
    algoState.current = {
      issue,
      ...prediction,
      createdAt:
        new Date().toISOString()
    };
  }

  if (
    !sim.pending &&
    prediction.confidence >= MIN_CONF
  ) {
    sim.pending = {
      issue,
      combos: [
        ...prediction.combos
      ],
      confidence:
        prediction.confidence,
      createdAt:
        new Date().toISOString()
    };
  }
}

/* 主更新 */
async function tick() {
  const state = loadState();

  const [kj, sz, sha] =
    await Promise.all([
      getJson("/api/kj.json?nbr=100"),
      getJson("/api/sz.json?nbr=1"),
      getJson("/api/sha.json?nbr=1")
    ]);

  const rows = getRows(kj);

  if (!rows.length) {
    throw new Error(
      "开奖接口没有数据"
    );
  }

  const latest = rows[0];

  state.latestDraw = {
    issue: latest.issue,
    sum: latest.sum,
    combo: latest.combo
  };

  state.nextIssue =
    String(
      Number(latest.issue) + 1
    );

  for (
    const id of ["a1", "a2", "a3"]
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

  const p1 =
    algo1(kj, sz, sha);

  const p2 =
    algo2(kj);

  const p3 =
    algo3(kj);

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
    `updated ${state.latestDraw.issue} -> ${state.nextIssue}`
  );
}

const loops =
  Number(
    process.env.POLL_LOOPS || 1
  );

const sleepMs =
  Number(
    process.env.POLL_INTERVAL_MS || 0
  );

for (let i = 0; i < loops; i++) {
  try {
    await tick();
  } catch (error) {
    console.error(error);

    if (i === loops - 1) {
      process.exitCode = 1;
    }
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
