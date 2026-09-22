# From Zero to Fintech Data Scientist in 52 Weeks

**Start:** Tuesday 22 September 2026 · **Finish:** Monday 20 September 2027

**Goals by the end:**
- 5+ mentors who are glad to work with you
- 2+ real-world, deployed fintech ML projects
- Solid Python, SQL, statistics and machine learning

The plan assumes you're a full-time student with no programming background. It needs about **10 hours a week plus 15 minutes of LinkedIn a day**. Everything below is also built into the tracker app in [`app/`](app/). Tick things off there, and it tells you what to do each day.

---

## 1. The year at a glance

| Phase | Weeks | Dates | What you'll be able to do |
|---|---|---|---|
| 1. Python Foundations | 1–8 | 22 Sep – 16 Nov 2026 | Write real programs: logic, data structures, functions, files, classes, Git, APIs, tests |
| 2. Data Analysis & SQL | 9–16 | 17 Nov 2026 – 11 Jan 2027 | NumPy, pandas, charts and SQL on real financial data; first public portfolio piece |
| 3. Math & Statistics | 17–20 | 12 Jan – 8 Feb 2027 | Probability, A/B testing, linear algebra, gradient descent, all on money problems |
| 4. Machine Learning | 21–32 | 9 Feb – 3 May 2027 | scikit-learn, boosting, imbalanced data, SHAP, clustering, anomaly detection. **Project 1** (Weeks 30–32) |
| 5. Advanced ML | 33–40 | 4 May – 28 Jun 2027 | Time series, deep learning (PyTorch), NLP and LLMs, graph analytics for fraud |
| 6. Production & Career | 41–52 | 29 Jun – 20 Sep 2027 | Testing, APIs, Docker, deployment, monitoring. **Project 2** (Weeks 45–48), interview prep, portfolio |

### Month-by-month checkpoints

| By… | You should have |
|---|---|
| End of Oct 2026 | Loan calculator, transaction ledger, bank-statement parser. LinkedIn profile fixed. 10–15 prospects identified and being engaged |
| End of Nov 2026 | A personal-finance CLI on GitHub with tests. First connection requests sent (Week 8) |
| End of Dec 2026 | pandas + charts on real credit data. First 15-minute calls held |
| End of Jan 2027 | SQL fraud queries, a published CFPB complaints analysis, A/B-testing skills. ~40 prospects in your pipeline |
| End of Feb 2027 | First ML models (regression, logistic, cost-based thresholds). **First mentor** (target Week 19–20) |
| End of Apr 2027 | Gradient boosting, SHAP reason codes, fraud models. 2–3 mentors |
| Early May 2027 | **Project 1 shipped:** Credit Risk Scoring System (scorecard + LightGBM + app) |
| End of Jun 2027 | Time series, deep learning, NLP/LLMs, graph fraud detection. 4–5 mentors |
| End of Aug 2027 | **Project 2 shipped:** Real-Time Fraud Detection Platform (API, Docker, dashboard, monitoring) |
| 20 Sep 2027 | Portfolio polished, interview-ready, 5+ mentors, year-2 plan |

---

## 2. Your weekly rhythm (alongside your studies)

| Day | Time (default) | What |
|---|---|---|
| Every day | 08:30, 15 min | LinkedIn: one thoughtful comment on 2–3 prospects' posts |
| Monday | 19:00, 1 h | Learn this week's concepts (course/video/reading) |
| Tuesday | 19:00, 1 h | Practice exercises |
| Wednesday | 19:00, 1 h | Learn this week's concepts |
| Thursday | 19:00, 1 h | Practice exercises |
| Saturday | 10:00, 3 h | **Fintech problem of the week** |
| Sunday | 16:00, 2 h | Finish the problem, push to GitHub, weekly review (tick off the tracker, log hours, write notes) |

All times can be changed in the app's **Settings**, and each one is a one-tap Google Calendar reminder there.

**Exam weeks:** tick *Exam week* on that week in the Roadmap. Do the skills, skip or shorten the fintech problem, and keep the 15 minutes of LinkedIn. Your degree comes first; the plan has slack for this.

---

## 3. How to learn so it sticks

1. **Build before you feel ready.** Each week's fintech problem is the real test. Watching tutorials without building is the #1 reason self-learners stall.
2. **The 20-minute rule.** Stuck? Struggle for 20 minutes, then search, read the docs, or ask an AI to *explain* (not to write the solution). Then close it and write the code yourself.
3. **Type everything.** Never copy-paste code from a course. Typing it is how your fingers learn Python.
4. **Explain it in writing.** Every notebook ends with 3–5 plain-English findings. This is also what you'll post on LinkedIn, and what you'll send mentors.
5. **Revisit.** Every weekly problem reuses earlier weeks (the app shows which ones). If a reused skill feels shaky, reopen that week before continuing.
6. **Push to GitHub every week from Week 7.** By month 12 you'll have ~45 commits of visible, dated progress. That's proof no certificate gives.

### Setup (Week 1)
- Python 3.12+ and VS Code, or start in **Google Colab** (nothing to install).
- A GitHub account (you'll use it from Week 7).
- Free accounts: Kaggle (datasets), ADPList, DataTalks.Club.

### Core free resources
- Python: [Harvard CS50P](https://cs50.harvard.edu/python/), [Kaggle Learn](https://www.kaggle.com/learn), [Automate the Boring Stuff](https://automatetheboringstuff.com/)
- Data: [Python for Data Analysis (free)](https://wesmckinney.com/book/), [SQLBolt](https://sqlbolt.com/)
- Stats & math: [StatQuest](https://www.youtube.com/@statquest), [3Blue1Brown](https://www.3blue1brown.com/), [Khan Academy](https://www.khanacademy.org/math/statistics-probability)
- ML: [ISLP (free book)](https://www.statlearning.com/), [scikit-learn guide](https://scikit-learn.org/stable/user_guide.html), [Andrew Ng's ML Specialization](https://www.coursera.org/specializations/machine-learning-introduction)
- Deep learning & NLP: [PyTorch basics](https://pytorch.org/tutorials/beginner/basics/intro.html), [fast.ai](https://course.fast.ai/), [Hugging Face course](https://huggingface.co/learn/llm-course)
- Production: [Made With ML](https://madewithml.com/), [MLOps Zoomcamp](https://github.com/DataTalksClub/mlops-zoomcamp)

Every week in the app lists the specific resources and datasets for that week.

---

## 4. The weekly fintech problems

Every week has a real-world problem that uses **this week's skills plus earlier weeks'**. They use real public financial datasets and build on each other, for example:

- **W1** Loan repayment calculator → **W2** amortization schedule + eligibility rules → **W4** refactored into a validation service → **W9** vectorised across 5,000 loans for a portfolio-loss simulation
- **W13** SQL on mobile-money transactions → **W14** velocity fraud rules → **W29** hybrid rules + anomaly detection → **W39** money-mule graph analytics → **W45–48** a full fraud platform
- **W10** credit-card defaults in pandas → **W22** cost-based approve/decline thresholds → **W25** LightGBM → **W27** reason codes and fair-lending checks → **W30–32** Credit Risk Scoring System

Datasets you'll use: UCI Default of Credit Card Clients, Give Me Some Credit, Home Credit, Lending Club, ULB Credit Card Fraud, PaySim mobile money, IEEE-CIS Fraud, UCI Online Retail II, UCI Bank Marketing, the CFPB Consumer Complaint Database, Financial PhraseBank, FRED and Yahoo Finance prices.

The full list of 52 problems, each with its context, data and tasks, is in the app's **Roadmap** tab.

---

## 5. The two (plus one) portfolio projects

| Project | When | What it proves |
|---|---|---|
| **Credit Risk Scoring System** | Weeks 30–32 | You can build what a credit-risk team ships: a WoE/IV scorecard, a LightGBM challenger, expected-profit curves, SHAP reason codes, a fairness check, a model card and a deployed loan-officer app |
| **Real-Time Fraud Detection Platform** | Weeks 45–48 | End-to-end ML engineering: velocity + graph features, a model ensemble with an alert budget, a FastAPI + Docker service, a streaming replay, an analyst dashboard and drift monitoring |
| Bonus: Neobank Churn Sprint | Week 51 | Speed: a complete project in 5 days |

A project counts as **shipped** only when it's public: code, README with results in business terms (dollars, approval rates), a live demo and a launch post.

---

## 6. The mentorship playbook

### Who to target
- **Data scientists 2–8 years into their careers** (Data Scientist, Senior Data Scientist, ML Engineer, Credit Risk Modeller, Fraud Data Scientist). Senior enough to guide you, not so senior they're buried. Skip Heads, Directors, VPs, Chiefs and Principals.
- **At fintechs, banks or payments companies:** startups, scale-ups or large firms.
- **Markets:** United States, Luxembourg and Denmark first, then fast-growing fintech hubs: UK, Netherlands, Germany, Ireland, Sweden, Estonia, Singapore, UAE, Nigeria, Kenya, Brazil, Canada, India. The app's **Finder** lists fintech companies for each market.
- **People who post or comment at least monthly.** You can only build familiarity with people who are active.
- **Green flags:** they reply to comments, mention mentoring/ADPList/teaching, or have a career path you'd like to follow.

### How to find them (Finder tab)
1. **LinkedIn people search** with a ready-made boolean query (e.g. `"data scientist" (fintech OR payments OR lending OR bank) NOT (director OR head OR VP …)`), then set the *Locations* filter.
2. **LinkedIn post search** sorted by date. This finds people who are actively posting, which is who you want.
3. **Google X-ray search** (`site:linkedin.com/in …`) when LinkedIn limits your searches.
4. **Company lists:** one click searches for data scientists at Lunar, Pleo, Danske Bank, PayPal Europe, Stripe, Plaid, Adyen, Revolut and more.
5. **Communities where mentors already are:** ADPList (free volunteer mentors), DataTalks.Club, Kaggle discussions, LHoFT (Luxembourg), Copenhagen FinTech.

### Getting notified when they post
Follow them, then tap the **bell icon** on their profile. LinkedIn will notify you of every post. The app tracks whether the bell is on for each prospect.

> **Why the app doesn't scrape LinkedIn:** LinkedIn has no public API for this, and it restricts or bans accounts that use scraping or automation tools. Doing the discovery by hand, with the bell for notifications, protects your account, and your account is your main networking tool this year.

### Finding an email (backup only)
LinkedIn is the main channel. If someone doesn't answer there after a follow-up, the app shows the most likely address patterns (`first.last@company.com`, etc.) and links to Hunter, Apollo and RocketReach to confirm the company's pattern and **verify** the address before you send. Send one polite, personal email, never bulk emails, and never add people to a mailing list. EU contacts are covered by GDPR, so keep it one-to-one and relevant.

### The timeline for every prospect
```
Day 0        Identify, add to the app, follow + bell on
Days 1–30    Comment thoughtfully when they post (4+ real comments)
Day 30+      App marks them "Ready" → send a connection request (short note)
Accepted     1–3 days later: the "After they accept" message (admire → value → small ask)
+7 days      One follow-up if no reply, with something new you've built
Replied      Offer a 15-minute call with 2–3 time options in their time zone
Call         Thank-you within 24 h + one action you'll take
+2 weeks     Report back on their advice, then make the mentorship ask
Mentor       Monthly update, every month
```
**Best time to message:** Tuesday–Thursday, 8–10am *their* time. Each prospect card shows their local time and says when it's a good moment.

### Comments that build familiarity: Anchor → Add → Ask
1. **Anchor:** name the specific point you're reacting to.
2. **Add:** a result from your weekly fintech problem, a counter-example or a resource.
3. **Ask:** a genuine question they'd enjoy answering.

> *"Your point about PR-AUC over ROC-AUC for fraud hit home. On the ULB card dataset this week, my ROC-AUC was 0.97 but PR-AUC only 0.71. Do you set thresholds on precision targets or on an alert budget for analysts?"*

Because your weekly problems are real fintech problems, you'll always have something real to add.

### Messages that work
Never open with "Will you be my mentor?". The pattern that works is **admire specifically → show what you've built → make a small, specific ask.** Mentorship grows out of 2–3 good exchanges where they see you act on their advice.

The app's **Messages** tab fills these templates with each prospect's name and topic and your latest project, and counts characters for connection notes:
- Connection request (≤200 characters)
- After they accept
- 7-day follow-up
- Thank-you after a call
- The mentorship ask
- Monthly mentor update
- Email version

**About LinkedIn limits:** free accounts have a weekly cap on connection requests and a small monthly allowance of personalised connection notes. If you run out of notes, connect without a note and send the "After they accept" message once they accept. A Premium free-trial month during your busiest outreach period (Weeks 8–20) is also an option.

### Selling value (why they'll be proud to mentor you)
- Show **consistent, visible progress**: weekly GitHub commits and a post every 2–3 weeks.
- **Act on their advice and report back.** This is what turns a helpful stranger into a mentor.
- Offer value back: replicate an idea from their post on a public dataset and credit them, summarise a talk they gave, or share a resource relevant to their work.
- Keep every ask small and specific, and respect their time (stop calls at 15 minutes).

### The numbers
About 1 in 10 people you engage with becomes a real mentor. So the plan builds a pipeline of **~60 prospects** by Week 37 (3–5 new people a week), with outreach in batches from Week 8:

| Week | Target |
|---|---|
| 3 | First 5 prospects identified |
| 8 | First connection requests |
| 11–12 | First calls |
| 19–20 | **Mentor #1** |
| 24 | 2 mentors |
| 29 | 3 mentors |
| 34 | 4 mentors |
| 39 | **5 mentors** |
| 52 | 5+ mentors, all receiving monthly updates |

---

## 7. Using the tracker app

Open **`app/index.html`** in any browser, or use the published version in Claude.

| Tab | What it does |
|---|---|
| **Today** | Week number, progress, streak, today's schedule (study + LinkedIn + classes), mentor actions (ready to connect, follow-ups due, who to engage), this week's checklist, school deadlines |
| **Roadmap** | All 52 weeks: skills, resources, fintech problem + tasks, mentor task, hours, exam-week toggle, notes. Every checkbox can be unticked |
| **Mentors** | Your prospect CRM: stage pipeline, 30-day readiness clock, comment log (with undo), bell tracking, fit score, local time, next action and date, calendar reminder per person |
| **Finder** | Generates LinkedIn, post and Google searches by market, role and company type; fintech company directory; mentor communities |
| **Messages** | Templates filled in for each prospect, character counts, copy buttons, the comment formula, call questions |
| **Studies** | Your courses, weekly timetable and deadlines, with reminders |
| **Projects** | Milestones, repo/demo links and "shipped" status for each portfolio project |
| **Progress** | A 52-week heatmap, phase progress, mentor funnel, hours chart |
| **Settings** | Your details for messages, schedule, **phone reminders** (Google Calendar links + .ics file), backup/restore |

**Reminders:** in Settings, tap each Google Calendar link once to add the repeating study sessions, the daily LinkedIn slot and the 4-weekly mentor review. Prospect follow-ups and school deadlines each have their own *Add reminder* link. On a computer you can also download a single `.ics` file with everything (all 52 week-starts, your routine, follow-ups, deadlines, classes) for Apple Calendar or Outlook. Re-download it after adding new prospects.

**Your data:** the published version saves to your Claude account, privately (other viewers can't see your data). The standalone file saves in that browser. Use **Export backup** regularly, and **Import** it on another device.

---

## 8. Rules for the year

1. Never miss two days in a row, even if one day is only 15 minutes.
2. Ship something public every week from Week 7.
3. Engage before you ask. 30 days, 4+ real comments.
4. Follow up once, then move on without taking it personally.
5. Always report back to someone who helped you.
6. In exam weeks, lighten the load rather than dropping the plan.
7. Review every Sunday: tick, log hours, write one note.
