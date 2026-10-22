# ReRoute_Frontend

## Local Demo

This repository is a static HTML/CSS/JavaScript client for the existing ReRoute
planner API. It does not require npm or a build step.

Start the backend first using `ReRoute_Backend/README.md`, then run:

```powershell
python -m http.server 5500
```

Open `http://localhost:5500`. The client sends real requests to
`http://127.0.0.1:8000/api/planner/recommend`; the backend must be running and
connected to a database containing the customer and supplier records shown in
the form.

To use another backend address, change `apiUrl` in `config.js`.