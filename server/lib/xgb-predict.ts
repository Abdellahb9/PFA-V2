// Pure-TypeScript inference for an XGBoost model exported to JSON (Booster
// save_raw("json")). The model is trained OFFLINE by scripts/train_forecast.py,
// so XGBoost itself never ships in a serverless function. Each tree is walked
// with the XGBoost rule (x[feature] < threshold -> left child); leaf value is
// split_conditions[leaf]; the prediction is base_score + sum of tree leaves.

interface XGBTree {
  split_indices: number[];
  split_conditions: number[];
  left_children: number[];
  right_children: number[];
  default_left: number[];
}

export interface XGBModel {
  feature_order: string[];
  model: {
    learner: {
      gradient_booster: { model: { trees: XGBTree[] } };
      learner_model_param: { base_score: string | number | number[] };
    };
  };
}

function baseScore(m: XGBModel): number {
  const b = m.model.learner.learner_model_param.base_score;
  const v = Array.isArray(b) ? b[0] : b;
  return Number(String(v).replace(/[[\]]/g, ""));
}

function predictTree(t: XGBTree, x: number[]): number {
  let node = 0;
  while (t.left_children[node] !== -1) {
    const f = t.split_indices[node];
    const value = x[f];
    const goLeft =
      value === undefined || Number.isNaN(value)
        ? t.default_left[node] === 1
        : value < t.split_conditions[node];
    node = goLeft ? t.left_children[node] : t.right_children[node];
  }
  return t.split_conditions[node]; // leaf value
}

/** Predict a single sample (features in the model's feature_order). */
export function predictXGB(model: XGBModel, x: number[]): number {
  const trees = model.model.learner.gradient_booster.model.trees;
  let sum = baseScore(model);
  for (const t of trees) sum += predictTree(t, x);
  return sum;
}
