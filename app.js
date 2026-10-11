const API_URL = (window.REROUTE_CONFIG?.apiUrl || "http://127.0.0.1:8000").replace(/\/$/, "");

const form = document.getElementById("planner-form");
const customer = document.getElementById("customer");
const quantity = document.getElementById("quantity");
const disruption = document.getElementById("disruption");
const supplierOptions = document.getElementById("supplier-options");
const spikeOptions = document.getElementById("spike-options");
const supplier = document.getElementById("supplier");
const spike = document.getElementById("spike");
const costWeight = document.getElementById("cost-weight");
const timeWeight = document.getElementById("time-weight");
const riskWeight = document.getElementById("risk-weight");
const industryProfile = document.getElementById("industry-profile");
const weightStatus = document.getElementById("weight-status");
const planButton = document.getElementById("plan-button");
const buttonLabel = document.getElementById("button-label");
const apiStatus = document.getElementById("api-status");
const apiStatusLabel = document.getElementById("api-status-label");
const resultStatus = document.getElementById("result-status");

const resultViews = {
  empty: document.getElementById("empty-result"),
  loading: document.getElementById("loading-result"),
  error: document.getElementById("error-result"),
  result: document.getElementById("actual-result"),
};

disruption.addEventListener("change", updateDisruptionFields);
form.addEventListener("submit", runPlanner);
[costWeight, timeWeight, riskWeight].forEach((input) => {
  input.addEventListener("input", validateWeights);
});

updateDisruptionFields();
checkApiStatus();

function updateDisruptionFields() {
  const supplierFailure = disruption.value === "supplier_failure";
  const demandSpike = disruption.value === "demand_spike";
  supplierOptions.classList.toggle("hidden", !supplierFailure);
  spikeOptions.classList.toggle("hidden", !demandSpike);
  supplier.required = supplierFailure;
  spike.required = demandSpike;
}

function validateWeights() {
  const values = [costWeight, timeWeight, riskWeight].map((input) => Number(input.value));
  const validNumbers = values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100);
  const total = values.reduce((sum, value) => sum + value, 0);
  weightStatus.textContent = `Total: ${total}%`;
  const valid = validNumbers && total === 100;
  weightStatus.classList.toggle("invalid", !valid);
  return valid;
}

async function checkApiStatus() {
  try {
    const response = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error("API unavailable");
    apiStatus.classList.add("online");
    apiStatus.classList.remove("offline");
    apiStatusLabel.textContent = "API connected";
  } catch {
    apiStatus.classList.remove("online");
    apiStatus.classList.add("offline");
    apiStatusLabel.textContent = "API offline";
  }
}

async function runPlanner(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  if (!validateWeights()) {
    weightStatus.focus?.();
    showError("Cost, delivery time, and risk preferences must total 100%.");
    return;
  }

  const customerId = Number(customer.value);
  const payload = {
    customer_id: customerId,
    quantity: Number(quantity.value),
    industry: industryProfile.value,
    disruption_type: disruption.value,
    supplier_id: disruption.value === "supplier_failure" ? Number(supplier.value) : null,
    disruption_customer_id: disruption.value === "demand_spike" ? customerId : null,
    demand_spike_percentage: disruption.value === "demand_spike" ? Number(spike.value) : null,
    weights: {
      cost: Number(costWeight.value) / 100,
      time: Number(timeWeight.value) / 100,
      risk: Number(riskWeight.value) / 100,
    },
    max_alternatives: 3,
  };

  setView("loading");
  resultStatus.textContent = "Planning";
  planButton.disabled = true;
  buttonLabel.textContent = "Planning...";

  try {
    const data = await window.rerouteRequest("/api/planner/recommend", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderResult(data);
    setView("result");
    resultStatus.textContent = "Complete";
    apiStatus.classList.add("online");
    apiStatus.classList.remove("offline");
    apiStatusLabel.textContent = "API connected";
  } catch (error) {
    showError(error instanceof Error ? error.message : "Unable to connect to the planner API.");
  } finally {
    planButton.disabled = false;
    buttonLabel.textContent = "Find recovery plans";
  }
}

function setView(view) {
  Object.entries(resultViews).forEach(([key, element]) => {
    element.classList.toggle("hidden", key !== view);
  });
}

function showError(message) {
  document.getElementById("error-message").textContent = message;
  resultStatus.textContent = "Needs attention";
  setView("error");
}

function renderResult(data) {
  const recommended = data.recommended_plan;
  const plan = recommended.plan;
  const risk = recommended.risk;

  document.getElementById("results-subtitle").textContent = "Ranked by your selected cost, time, and risk preferences.";
  document.getElementById("recommendation-heading").textContent = `Supplier ${plan.supplier_id} to customer ${plan.customer_id}`;
  document.getElementById("cost").textContent = formatCost(plan.total_cost);
  document.getElementById("time").textContent = `${plan.total_days} day${plan.total_days === 1 ? "" : "s"}`;
  document.getElementById("risk-label").textContent = risk.risk_is_partial ? "Supplier risk only" : "Plan risk";
  document.getElementById("risk").textContent = formatRisk(risk);
  document.getElementById("score").textContent = Number(recommended.overall_score).toFixed(3);
  document.getElementById("explanation").textContent = data.explanation || "This plan ranked highest among the feasible options.";
  document.getElementById("scenario").textContent = describeScenario(data.scenario);

  renderRoute(plan.path || []);
  renderActions(data.actions || []);
  renderAlternatives(data.alternatives || []);
  renderRejected(data.rejected_candidates || []);
}

function renderRejected(rejected) {
  const section = document.getElementById("rejected-section");
  const list = document.getElementById("rejected-list");
  list.replaceChildren();
  section.classList.toggle("hidden", rejected.length === 0);
  document.getElementById("rejected-count").textContent = `${rejected.length} rejected`;
  rejected.forEach((candidate) => {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = candidate.path?.length
      ? `Supplier ${candidate.supplier_id}: ${candidate.path.map(prettyNode).join(" → ")}`
      : `Supplier ${candidate.supplier_id}`;
    const reasons = document.createElement("p");
    reasons.textContent = (candidate.reasons || []).join("; ");
    item.append(title, reasons);
    list.append(item);
  });
}

function renderRoute(path) {
  const container = document.getElementById("route");
  container.replaceChildren();
  document.getElementById("route-length").textContent = `${path.length} stops`;

  path.forEach((value, index) => {
    const [type = "Node", ...idParts] = String(value).split(":");
    const item = document.createElement("li");
    item.className = "route-stop";

    const marker = document.createElement("span");
    marker.className = "route-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = String(index + 1).padStart(2, "0");

    const label = document.createElement("span");
    label.className = "route-name";
    label.textContent = `${capitalize(type)} ${idParts.join(":")}`.trim();

    item.append(marker, label);
    container.append(item);
  });
}

function renderActions(actions) {
  const container = document.getElementById("actions");
  container.replaceChildren();
  if (actions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-copy";
    empty.textContent = "No additional actions were generated.";
    container.append(empty);
    return;
  }

  actions.forEach((action) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    const description = document.createElement("p");
    name.textContent = action.name.replaceAll("_", " ");
    description.textContent = action.description;
    item.append(name, description);
    container.append(item);
  });
}

function renderAlternatives(alternatives) {
  const container = document.getElementById("alternatives-list");
  container.replaceChildren();
  document.getElementById("alternative-count").textContent = `${alternatives.length} shown`;
  if (alternatives.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-copy empty-alternatives";
    empty.textContent = "No other feasible plans for this scenario.";
    container.append(empty);
    return;
  }

  alternatives.forEach((scored) => {
    const row = document.createElement("article");
    row.className = "alternative-row";
    const rank = document.createElement("span");
    rank.className = "alternative-rank";
    rank.textContent = `#${scored.rank}`;
    const route = document.createElement("span");
    route.className = "alternative-route";
    route.textContent = (scored.plan.path || []).map(prettyNode).join("  →  ");
    const metrics = document.createElement("span");
    metrics.className = "alternative-metrics";
    metrics.textContent = `${formatCost(scored.plan.total_cost)}  ·  ${scored.plan.total_days}d  ·  ${formatRisk(scored.risk)}`;
    row.append(rank, route, metrics);
    container.append(row);
  });
}

function describeScenario(scenario) {
  if (!scenario) return "Scenario details unavailable.";
  const scenarioName = scenario.type === "none"
    ? "No disruption"
    : capitalize(scenario.type.replaceAll("_", " "));
  const parts = [scenarioName, `Customer ${scenario.customer_id}`, `${scenario.quantity} units`];
  if (scenario.supplier_id) parts.push(`Supplier ${scenario.supplier_id} failed`);
  if (scenario.percentage != null) parts.push(`Demand +${scenario.percentage}%`);
  return parts.join("  ·  ");
}

function prettyNode(value) {
  const [type = "Node", ...idParts] = String(value).split(":");
  return `${capitalize(type)} ${idParts.join(":")}`.trim();
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Node";
}

function formatCost(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function formatPercent(value) {
  if (value == null || !Number.isFinite(Number(value))) return "Unavailable";
  return `${((Number(value) || 0) * 100).toFixed(1)}%`;
}

function formatRisk(risk) {
  if (risk?.risk_is_partial) {
    return `Supplier-only ${formatPercent(risk.supplier_failure_probability)}`;
  }
  if (risk?.plan_risk == null) return "Unavailable";
  return `${formatPercent(risk.plan_risk)} modelled`;
}