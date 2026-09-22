# Tracking_App: Fintech ML Ledger

A 12-month plan (22 Sep 2026 → 20 Sep 2027) to learn Python and machine learning from scratch for fintech, find 5+ mentors, and ship 2+ real-world projects, with a tracker app to run it.

- **[GUIDE.md](GUIDE.md)**: the complete written guide: phases, weekly rhythm, learning method, projects and the mentorship playbook.
- **[app/](app/)**: the tracker app (plain HTML/JS, no install).

## Run the app

Open `app/index.html` in a browser (double-click it), or serve the folder:

```bash
cd app && python3 -m http.server 8000
# then open http://localhost:8000
```

Data is saved in the browser's local storage. Use **Settings → Export backup** to move it between devices. When published as a Claude artifact, it saves privately to your Claude account instead.

## What's inside

| File | Contents |
|---|---|
| `app/curriculum.js` | 52 weeks: skills, resources, cumulative fintech problems, weekly mentor tasks, and the project milestones |
| `app/network.js` | Target markets and fintech companies, mentor communities, message templates, comment formula, call questions |
| `app/app.js` | The app: Today, Roadmap, Mentors (CRM), Finder, Messages, Studies, Projects, Progress, Settings, calendar export |
| `app/index.html` | Page shell and styles |

To change the plan, edit `curriculum.js`. Checkbox progress is keyed by week and item position, so reordering items within a week moves the ticks with them.
