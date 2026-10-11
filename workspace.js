(() => {
  const API_BASE = (window.REROUTE_CONFIG?.apiUrl || "http://127.0.0.1:8000").replace(/\/$/, "");
  const TOKEN_KEY = "reroute.accessToken";
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { user: null, entities: {}, scenarios: [], runs: [], editing: null };

  const profileWeights = {
    retail: [40, 35, 25],
    manufacturing: [30, 40, 30],
    ecommerce: [35, 30, 35],
    healthcare: [20, 30, 50],
  };

  const entityDefinitions = {
    suppliers: {
      label: "Supplier",
      fields: [
        ["supplier_code", "Supplier code", "text"], ["name", "Name", "text"],
        ["capacity", "Capacity", "number", { min: 1 }], ["unit_cost", "Unit cost", "number", { min: 0, step: "0.01" }],
        ["reliability", "Reliability (0-1)", "number", { min: 0, max: 1, step: "0.001" }], ["available", "Available", "checkbox"],
      ],
      columns: [["supplier_code", "Code"], ["name", "Name"], ["capacity", "Capacity"], ["unit_cost", "Unit cost"], ["reliability", "Reliability"], ["available", "Available"]],
    },
    customers: {
      label: "Customer",
      fields: [["customer_code", "Customer code", "text"], ["name", "Name", "text"], ["demand", "Demand", "number", { min: 1 }], ["deadline_days", "Deadline (days)", "number", { min: 1 }]],
      columns: [["customer_code", "Code"], ["name", "Name"], ["demand", "Demand"], ["deadline_days", "Deadline"]],
    },
    warehouses: {
      label: "Warehouse",
      fields: [["warehouse_code", "Warehouse code", "text"], ["name", "Name", "text"], ["capacity", "Capacity", "number", { min: 1 }], ["inventory", "Inventory", "number", { min: 0 }]],
      columns: [["warehouse_code", "Code"], ["name", "Name"], ["capacity", "Capacity"], ["inventory", "Inventory"]],
    },
    factories: {
      label: "Factory",
      fields: [["factory_code", "Factory code", "text"], ["name", "Name", "text"], ["capacity", "Capacity", "number", { min: 1 }], ["available", "Available", "checkbox"]],
      columns: [["factory_code", "Code"], ["name", "Name"], ["capacity", "Capacity"], ["available", "Available"]],
    },
    routes: {
      label: "Route",
      fields: [
        ["route_code", "Route code", "text"], ["source_type", "Source type", "select", { options: ["supplier", "factory", "warehouse"] }],
        ["source_id", "Source ID", "number", { min: 1 }], ["destination_type", "Destination type", "select", { options: ["factory", "warehouse", "customer"] }],
        ["destination_id", "Destination ID", "number", { min: 1 }], ["transportation_cost", "Transport cost", "number", { min: 0, step: "0.01" }],
        ["delivery_time_days", "Delivery time (days)", "number", { min: 1 }], ["capacity", "Capacity", "number", { min: 1 }], ["available", "Available", "checkbox"],
      ],
      columns: [["route_code", "Code"], ["source_type", "From"], ["source_id", "From ID"], ["destination_type", "To"], ["destination_id", "To ID"], ["capacity", "Capacity"], ["available", "Available"]],
    },
  };

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  function errorMessage(detail, fallback) {
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((item) => item.msg || "Invalid value").join("; ");
    return fallback;
  }

  async function apiRequest(path, options = {}, allowUnauthenticated = false) {
    const headers = new Headers(options.headers || {});
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (token && !allowUnauthenticated) headers.set("Authorization", `Bearer ${token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    } catch {
      throw new ApiError(0, "Could not reach the ReRoute API. Check the server and configured API address.");
    }

    const body = await response.json().catch(() => null);
    if (response.status === 401 && token && !allowUnauthenticated) {
      showLogin("Your session expired. Sign in again.");
    }
    if (!response.ok) {
      const fallback = response.status === 403
        ? "Your role is not permitted to perform this action."
        : response.status === 409
          ? "No feasible plan was found. Review the feasibility details and try a different scenario."
          : `Request failed (${response.status}).`;
      throw new ApiError(response.status, errorMessage(body?.detail, fallback));
    }
    return body;
  }

  window.rerouteRequest = apiRequest;
  window.rerouteUser = () => state.user;

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function setMessage(target, message = "", kind = "") {
    target.textContent = message;
    target.classList.toggle("error-copy", kind === "error");
    target.classList.toggle("success-copy", kind === "success");
  }

  function showLogin(message = "") {
    sessionStorage.removeItem(TOKEN_KEY);
    state.user = null;
    $("#app-shell").classList.add("hidden");
    $("#login-view").classList.remove("hidden");
    $("#account-bar").classList.add("hidden");
    setMessage($("#login-message"), message, message ? "error" : "");
  }

  function setLoading(button, label, busy, busyLabel) {
    button.disabled = busy;
    label.textContent = busy ? busyLabel : label.dataset.idle;
  }

  async function establishSession(token) {
    sessionStorage.setItem(TOKEN_KEY, token);
    try {
      state.user = await apiRequest("/api/auth/me");
    } catch (error) {
      showLogin(error.message);
      return false;
    }
    await enterWorkspace();
    return true;
  }

  async function enterWorkspace() {
    const user = state.user;
    const organization = user.organization;
    $("#login-view").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
    $("#account-bar").classList.remove("hidden");
    $("#account-label").textContent = user.full_name;
    $("#organization-name").textContent = organization.name;
    $("#user-role").textContent = user.role;
    $("#team-tab").classList.toggle("hidden", user.role !== "admin");
    document.querySelectorAll(".role-planner").forEach((control) => {
      control.classList.toggle("hidden", !["admin", "planner"].includes(user.role));
    });

    const profile = localStorage.getItem(`reroute.industry.${user.id}`) || "retail";
    $("#industry-profile").value = profile;
    applyProfileWeights(profile);
    setView("overview-view", false);
    await loadCatalogs();
    await loadOverview();
  }

  async function loadCatalogs() {
    const types = Object.keys(entityDefinitions);
    const results = await Promise.all(types.map(async (type) => [type, await apiRequest(`/api/business/${type}`)]));
    state.entities = Object.fromEntries(results);
    populateEntitySelect("#customer", "customers", "Select a customer");
    populateEntitySelect("#supplier", "suppliers", "Select a supplier");
    populateEntitySelect("#scenario-customer", "customers", "Select a customer");
    populateEntitySelect("#scenario-supplier", "suppliers", "Select a supplier");
  }

  function populateEntitySelect(selector, type, placeholder) {
    const select = $(selector);
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(node("option", "", placeholder));
    select.options[0].value = "";
    (state.entities[type] || []).forEach((item) => {
      const option = node("option", "", `${item.id} · ${item.name}`);
      option.value = String(item.id);
      select.append(option);
    });
    if (selected) select.value = selected;
  }

  function setView(id, refresh = true) {
    document.querySelectorAll(".view-panel").forEach((panel) => panel.classList.toggle("hidden", panel.id !== id));
    document.querySelectorAll(".nav-tab").forEach((tab) => {
      const selected = tab.dataset.view === id;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-current", selected ? "page" : "false");
    });
    if (refresh && id === "overview-view") loadOverview();
    if (refresh && id === "supply-view") loadEntities();
    if (refresh && id === "scenario-view") loadScenarios();
    if (refresh && id === "history-view") loadHistory();
    if (refresh && id === "team-view" && state.user.role === "admin") loadMembers();
  }

  async function loadOverview() {
    const panel = $("#overview-metrics");
    panel.replaceChildren(node("p", "loading-copy", "Loading organization data…"));
    try {
      const [suppliers, customers, warehouses, factories, routes, runs] = await Promise.all([
        apiRequest("/api/business/suppliers"), apiRequest("/api/business/customers"),
        apiRequest("/api/business/warehouses"), apiRequest("/api/business/factories"),
        apiRequest("/api/business/routes"), apiRequest("/api/business/planning-runs"),
      ]);
      state.entities = { suppliers, customers, warehouses, factories, routes };
      state.runs = runs;
      panel.replaceChildren();
      [["Suppliers", suppliers.length], ["Customers", customers.length], ["Warehouses", warehouses.length], ["Factories", factories.length], ["Routes", routes.length], ["Planning runs", runs.length]].forEach(([label, count]) => {
        const metric = node("article", "summary-item");
        metric.append(node("span", "summary-label", label), node("strong", "summary-value", String(count)));
        panel.append(metric);
      });
      renderRecentRuns(runs.slice(0, 5));
      populateEntitySelect("#customer", "customers", "Select a customer");
      populateEntitySelect("#supplier", "suppliers", "Select a supplier");
      populateEntitySelect("#scenario-customer", "customers", "Select a customer");
      populateEntitySelect("#scenario-supplier", "suppliers", "Select a supplier");
    } catch (error) {
      panel.replaceChildren(node("p", "error-copy", error.message));
      renderRecentRuns([]);
    }
  }

  function renderRecentRuns(runs) {
    const target = $("#recent-runs");
    target.replaceChildren();
    if (!runs.length) {
      target.append(node("p", "muted-copy", "No planning runs yet."));
      return;
    }
    runs.forEach((run) => {
      const row = node("button", "recent-run");
      row.type = "button";
      row.append(node("span", "recent-run-title", `Customer ${run.requested_customer_id} · ${run.requested_quantity} units`));
      row.append(node("span", "recent-run-meta", `${titleCase(run.disruption_type)} · ${formatDate(run.created_at)}`));
      row.addEventListener("click", () => { setView("history-view"); openRun(run.id); });
      target.append(row);
    });
  }

  async function loadEntities() {
    const type = $("#entity-type").value;
    const slot = $("#entity-table-slot");
    slot.replaceChildren(node("p", "loading-copy", "Loading records…"));
    $("#new-entity-button").classList.toggle("hidden", !canWrite());
    try {
      state.entities[type] = await apiRequest(`/api/business/${type}`);
      renderEntityTable(type);
    } catch (error) {
      slot.replaceChildren(node("p", "error-copy", error.message));
    }
  }

  function renderEntityTable(type) {
    const definition = entityDefinitions[type];
    const rows = state.entities[type] || [];
    const slot = $("#entity-table-slot");
    slot.replaceChildren();
    if (!rows.length) {
      slot.append(node("p", "empty-copy", `No ${type} are available to this organization.`));
      return;
    }
    const wrapper = node("div", "table-scroll");
    const table = node("table", "data-table");
    const thead = node("thead");
    const header = node("tr");
    header.append(node("th", "", "ID"));
    definition.columns.forEach(([, label]) => header.append(node("th", "", label)));
    header.append(node("th", "", "Actions"));
    thead.append(header);
    const tbody = node("tbody");
    rows.forEach((record) => {
      const tr = node("tr");
      tr.append(node("td", "mono-cell", String(record.id)));
      definition.columns.forEach(([key]) => tr.append(node("td", "", typeof record[key] === "boolean" ? (record[key] ? "Yes" : "No") : String(record[key] ?? "—"))));
      const actions = node("td", "row-actions");
      if (canWrite()) {
        const edit = node("button", "text-button", "Edit");
        edit.type = "button";
        edit.addEventListener("click", () => showEntityForm(type, record));
        actions.append(edit);
      }
      if (state.user.role === "admin") {
        const remove = node("button", "text-button danger-button", "Delete");
        remove.type = "button";
        remove.addEventListener("click", () => deleteEntity(type, record));
        actions.append(remove);
      }
      tr.append(actions);
      tbody.append(tr);
    });
    table.append(thead, tbody);
    wrapper.append(table);
    slot.append(wrapper);
  }

  function showEntityForm(type, record = null) {
    const definition = entityDefinitions[type];
    const slot = $("#entity-form-slot");
    slot.replaceChildren();
    state.editing = record ? { type, id: record.id } : null;
    const form = node("form", "inline-editor workflow-form");
    const heading = node("div", "data-heading");
    heading.append(node("h3", "", `${record ? "Edit" : "Add"} ${definition.label.toLowerCase()}`));
    const cancel = node("button", "text-button", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => slot.replaceChildren());
    heading.append(cancel);
    const grid = node("div", "form-grid");
    definition.fields.forEach(([key, label, typeName, options = {}], index) => {
      const fieldLabel = node("label", "", label);
      const id = `entity-${type}-${key}-${index}`;
      let control;
      if (typeName === "select") {
        control = node("select");
        options.options.forEach((value) => control.append(new Option(titleCase(value), value)));
      } else {
        control = node("input");
        control.type = typeName;
        if (typeName !== "checkbox") control.required = true;
      }
      control.id = id;
      control.name = key;
      if (options.min !== undefined) control.min = String(options.min);
      if (options.max !== undefined) control.max = String(options.max);
      if (options.step !== undefined) control.step = String(options.step);
      if (typeName === "checkbox") control.checked = record ? Boolean(record[key]) : true;
      else if (record && record[key] != null) control.value = String(record[key]);
      fieldLabel.htmlFor = id;
      fieldLabel.append(control);
      grid.append(fieldLabel);
    });
    const message = node("p", "form-message");
    message.setAttribute("role", "status");
    const submit = node("button", "primary-button", record ? "Save changes" : `Add ${definition.label.toLowerCase()}`);
    submit.type = "submit";
    form.append(heading, grid, message, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = Object.fromEntries(new FormData(form).entries());
      definition.fields.forEach(([key, , typeName]) => {
        const control = form.elements.namedItem(key);
        if (typeName === "checkbox") payload[key] = control.checked;
        else if (typeName === "number") payload[key] = Number(payload[key]);
      });
      submit.disabled = true;
      try {
        const method = record ? "PUT" : "POST";
        const path = `/api/business/${type}${record ? `/${record.id}` : ""}`;
        await apiRequest(path, { method, body: JSON.stringify(payload) });
        setMessage(message, `${definition.label} saved.`, "success");
        slot.replaceChildren();
        await loadCatalogs();
        await loadEntities();
      } catch (error) {
        setMessage(message, error.message, "error");
        submit.disabled = false;
      }
    });
    slot.append(form);
    form.querySelector("input, select")?.focus();
  }

  async function deleteEntity(type, record) {
    if (!window.confirm(`Delete ${entityDefinitions[type].label.toLowerCase()} ${record.name || record.route_code || record.id}?`)) return;
    try {
      await apiRequest(`/api/business/${type}/${record.id}`, { method: "DELETE" });
      await loadCatalogs();
      await loadEntities();
    } catch (error) {
      $("#entity-table-slot").prepend(node("p", "error-copy", error.message));
    }
  }

  async function loadScenarios() {
    const slot = $("#scenario-list");
    slot.replaceChildren(node("p", "loading-copy", "Loading scenarios…"));
    updateScenarioFields();
    try {
      state.scenarios = await apiRequest("/api/business/scenarios");
      renderScenarios();
    } catch (error) {
      slot.replaceChildren(node("p", "error-copy", error.message));
    }
  }

  function updateScenarioFields() {
    const type = $("#scenario-type").value;
    const supplierField = $(".scenario-supplier-field");
    const spikeField = $(".scenario-spike-field");
    const routeFields = document.querySelectorAll(".scenario-routes-field");
    supplierField.classList.toggle("hidden", !["supplier_failure", "simultaneous"].includes(type));
    spikeField.classList.toggle("hidden", type !== "demand_spike");
    routeFields.forEach((field) => field.classList.toggle("hidden", type !== "simultaneous"));
    $("#scenario-supplier").required = ["supplier_failure", "simultaneous"].includes(type);
    $("#scenario-spike-field input")?.toggleAttribute("required", type === "demand_spike");
    $(".scenario-spike-field input").required = type === "demand_spike";
  }

  function parseIdList(value) {
    if (!value.trim()) return [];
    const ids = value.split(",").map((item) => Number(item.trim()));
    if (ids.some((id) => !Number.isInteger(id) || id < 1)) throw new Error("Enter route IDs as comma-separated positive integers.");
    return ids;
  }

  async function createScenario(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const type = values.scenario_type;
    let payload;
    try {
      payload = {
        name: values.name,
        scenario_type: type,
        customer_id: Number(values.customer_id),
        quantity: Number(values.quantity),
        notes: values.notes || null,
        route_ids: type === "simultaneous" ? parseIdList(values.route_ids || "") : [],
        simultaneous_route_ids: type === "simultaneous" ? parseIdList(values.simultaneous_route_ids || "") : [],
      };
    } catch (error) {
      setMessage($("#scenario-message"), error.message, "error");
      return;
    }
    if (["supplier_failure", "simultaneous"].includes(type)) payload.supplier_id = Number(values.supplier_id);
    if (type === "demand_spike") payload.demand_spike_percentage = Number(values.demand_spike_percentage);
    const message = $("#scenario-message");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    setMessage(message, "Saving scenario…");
    try {
      await apiRequest("/api/business/scenarios", { method: "POST", body: JSON.stringify(payload) });
      form.reset();
      updateScenarioFields();
      setMessage(message, "Scenario saved.", "success");
      await loadScenarios();
    } catch (error) {
      setMessage(message, error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  function renderScenarios() {
    const slot = $("#scenario-list");
    slot.replaceChildren();
    if (!state.scenarios.length) {
      slot.append(node("p", "empty-copy", "No saved scenarios for this organization."));
      return;
    }
    state.scenarios.forEach((scenario) => {
      const item = node("article", "record-row");
      const details = node("div", "record-main");
      details.append(node("strong", "record-title", scenario.name));
      details.append(node("span", "record-meta", `${titleCase(scenario.scenario_type)} · Customer ${scenario.customer_id} · ${scenario.quantity} units · ${formatDate(scenario.created_at)}`));
      const run = node("button", "secondary-button", "Run scenario");
      run.type = "button";
      run.disabled = !canWrite();
      run.addEventListener("click", async () => {
        run.disabled = true;
        setMessage($("#scenario-message"), "Executing scenario with the planner…");
        try {
          const result = await apiRequest(`/api/business/scenarios/${scenario.id}/execute`, { method: "POST" });
          setMessage($("#scenario-message"), `Run ${result.id} completed.`, "success");
          await loadOverview();
        } catch (error) {
          setMessage($("#scenario-message"), error.message, "error");
        } finally {
          run.disabled = !canWrite();
        }
      });
      item.append(details, run);
      slot.append(item);
    });
  }

  async function loadHistory() {
    const slot = $("#history-list");
    slot.replaceChildren(node("p", "loading-copy", "Loading planning history…"));
    try {
      state.runs = await apiRequest("/api/business/planning-runs");
      slot.replaceChildren();
      if (!state.runs.length) {
        slot.append(node("p", "empty-copy", "No planning runs have been saved."));
        $("#history-detail").replaceChildren(node("p", "muted-copy", "Run a planner request or saved scenario to create history."));
        return;
      }
      state.runs.forEach((run) => {
        const button = node("button", "history-row");
        button.type = "button";
        button.append(node("strong", "record-title", `Run ${run.id} · Customer ${run.requested_customer_id}`));
        button.append(node("span", "record-meta", `${titleCase(run.disruption_type)} · ${run.requested_quantity} units · ${formatDate(run.created_at)}`));
        button.addEventListener("click", () => openRun(run.id));
        slot.append(button);
      });
    } catch (error) {
      slot.replaceChildren(node("p", "error-copy", error.message));
    }
  }

  async function openRun(runId) {
    const detail = $("#history-detail");
    detail.replaceChildren(node("p", "loading-copy", "Loading run comparison…"));
    try {
      const [comparison, explanation] = await Promise.all([
        apiRequest(`/api/business/planning-runs/${runId}/comparison`),
        apiRequest(`/api/business/planning-runs/${runId}/explanation`),
      ]);
      detail.replaceChildren(node("h3", "", `Run ${runId} comparison`));
      detail.append(node("p", "run-explanation", comparison.explanation || explanation.explanation || "No explanation was recorded."));
      const feasibility = explanation.feasibility || {};
      detail.append(node("p", "record-meta", `Feasible: ${feasibility.feasible ? "Yes" : "No"} · Status: ${explanation.risk_summary?.status || "unknown"}`));
      appendComparedPlan(detail, "Selected plan", comparison.selected_plan);
      (comparison.alternatives || []).forEach((plan, index) => appendComparedPlan(detail, `Alternative ${index + 1}`, plan));
      if ((comparison.actions || []).length) {
        detail.append(node("h4", "detail-heading", "Suggested actions"));
        const list = node("ul", "detail-list");
        comparison.actions.forEach((action) => list.append(node("li", "", action.description || action.name || "Action")));
        detail.append(list);
      }
    } catch (error) {
      detail.replaceChildren(node("p", "error-copy", error.message));
    }
  }

  function appendComparedPlan(target, heading, scored) {
    if (!scored || !scored.plan) return;
    const plan = scored.plan;
    const risk = scored.risk || {};
    const section = node("article", "comparison-plan");
    section.append(node("h4", "", heading));
    section.append(node("p", "route-line", (plan.path || []).join(" → ")));
    section.append(node("p", "record-meta", `${formatMoney(plan.total_cost)} · ${plan.total_days} days · ${formatRisk(risk)} · Score ${Number(scored.overall_score ?? 0).toFixed(3)}`));
    target.append(section);
  }

  async function loadMembers() {
    const slot = $("#member-list");
    slot.replaceChildren(node("p", "loading-copy", "Loading members…"));
    try {
      const users = await apiRequest(`/api/business/organizations/${state.user.organization.id}/users`);
      slot.replaceChildren();
      if (!users.length) {
        slot.append(node("p", "empty-copy", "No members were returned for this organization."));
        return;
      }
      const table = node("table", "data-table");
      const head = node("thead");
      const header = node("tr");
      ["Name", "Email", "Role", "Status"].forEach((label) => header.append(node("th", "", label)));
      head.append(header);
      const body = node("tbody");
      users.forEach((user) => {
        const row = node("tr");
        [user.full_name, user.email, user.role, user.is_active ? "Active" : "Inactive"].forEach((value) => row.append(node("td", "", value)));
        body.append(row);
      });
      table.append(head, body);
      const wrapper = node("div", "table-scroll");
      wrapper.append(table);
      slot.append(wrapper);
    } catch (error) {
      slot.replaceChildren(node("p", "error-copy", error.message));
    }
  }

  async function createMember(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const message = $("#member-message");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    setMessage(message, "Adding member…");
    try {
      await apiRequest(`/api/business/organizations/${state.user.organization.id}/users`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      form.reset();
      setMessage(message, "Member added.", "success");
      await loadMembers();
    } catch (error) {
      setMessage(message, error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  function canWrite() {
    return ["admin", "planner"].includes(state.user?.role);
  }

  function applyProfileWeights(profile) {
    const weights = profileWeights[profile] || profileWeights.retail;
    ["#cost-weight", "#time-weight", "#risk-weight"].forEach((selector, index) => {
      $(selector).value = String(weights[index]);
    });
    $("#weight-status").textContent = `Profile defaults: ${weights.join(" / ")}%`;
    $("#weight-status").classList.remove("invalid");
  }

  function formatRisk(risk) {
    if (risk?.risk_is_partial) return `Supplier-only ${formatPercent(risk.supplier_failure_probability)}; route data unknown`;
    if (risk?.plan_risk == null) return "Risk unavailable";
    return `${formatPercent(risk.plan_risk)} modelled`;
  }

  function formatPercent(value) {
    if (value == null || !Number.isFinite(Number(value))) return "Unknown";
    return `${(Number(value) * 100).toFixed(1)}%`;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value) || 0);
  }

  function formatDate(value) {
    if (!value) return "Date unavailable";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "Date unavailable" : date.toLocaleString();
  }

  function titleCase(value) {
    return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function bindEvents() {
    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const button = $("#login-button");
      const label = $("#login-button-label");
      label.dataset.idle ||= label.textContent;
      setLoading(button, label, true, "Signing in…");
      setMessage($("#login-message"));
      try {
        const credentials = Object.fromEntries(new FormData(form).entries());
        const tokenResponse = await apiRequest("/api/auth/token", { method: "POST", body: JSON.stringify(credentials) }, true);
        await establishSession(tokenResponse.access_token);
      } catch (error) {
        setMessage($("#login-message"), error.message, "error");
      } finally {
        setLoading(button, label, false, "");
      }
    });

    $("#logout-button").addEventListener("click", () => showLogin("You have signed out."));
    document.querySelectorAll(".nav-tab").forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.view)));
    document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.go)));
    $("#industry-profile").addEventListener("change", (event) => {
      localStorage.setItem(`reroute.industry.${state.user.id}`, event.target.value);
      applyProfileWeights(event.target.value);
    });
    $("#entity-type").addEventListener("change", () => { $("#entity-form-slot").replaceChildren(); loadEntities(); });
    $("#new-entity-button").addEventListener("click", () => showEntityForm($("#entity-type").value));
    $("#scenario-type").addEventListener("change", updateScenarioFields);
    $("#scenario-form").addEventListener("submit", createScenario);
    $("#refresh-scenarios").addEventListener("click", loadScenarios);
    $("#member-form").addEventListener("submit", createMember);
  }

  async function restoreSession() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      state.user = await apiRequest("/api/auth/me");
      await enterWorkspace();
    } catch (error) {
      showLogin(error.status === 401 ? "Your session expired. Sign in again." : error.message);
    }
  }

  bindEvents();
  updateScenarioFields();
  restoreSession();
})();