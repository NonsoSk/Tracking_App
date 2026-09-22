/*
 * Mentor-network data: target markets, fintech companies with data teams,
 * places mentors gather, and message templates.
 */
(function () {
  const markets = [
    { id: "us-e", name: "United States (East)", tz: "America/New_York", primary: true,
      companies: ["Capital One", "JPMorgan Chase", "American Express", "Mastercard", "Bloomberg", "Betterment", "Dave", "Marqeta", "Paxos", "Chime"] },
    { id: "us-c", name: "United States (Central)", tz: "America/Chicago", primary: true,
      companies: ["Discover", "Northern Trust", "Avant", "Enova", "Fiserv", "Synchrony"] },
    { id: "us-w", name: "United States (West)", tz: "America/Los_Angeles", primary: true,
      companies: ["Stripe", "Plaid", "Brex", "Ramp", "Affirm", "SoFi", "Robinhood", "Mercury", "Upstart", "Block (Cash App)", "PayPal", "Visa"] },
    { id: "lu", name: "Luxembourg", tz: "Europe/Luxembourg", primary: true,
      companies: ["PayPal Europe", "Amazon Payments Europe", "Rakuten Europe Bank", "Advanzia Bank", "BGL BNP Paribas", "Spuerkeess", "Banque Internationale à Luxembourg", "Clearstream", "LHoFT (fintech hub)"] },
    { id: "dk", name: "Denmark", tz: "Europe/Copenhagen", primary: true,
      companies: ["Lunar", "Pleo", "Danske Bank", "Saxo Bank", "Nets (Nexi Group)", "Vipps MobilePay", "Nordea", "Ageras", "Copenhagen FinTech (hub)"] },
    { id: "uk", name: "United Kingdom", tz: "Europe/London",
      companies: ["Revolut", "Monzo", "Wise", "Starling Bank", "Checkout.com", "GoCardless", "Zopa", "OakNorth", "ClearScore"] },
    { id: "nl", name: "Netherlands", tz: "Europe/Amsterdam",
      companies: ["Adyen", "bunq", "Mollie", "Bitvavo", "ING"] },
    { id: "de", name: "Germany", tz: "Europe/Berlin",
      companies: ["N26", "Trade Republic", "Solaris", "Scalable Capital", "Raisin", "SumUp"] },
    { id: "ie", name: "Ireland", tz: "Europe/Dublin",
      companies: ["Stripe (Dublin)", "Fenergo", "Wayflyer", "Revolut (Dublin)"] },
    { id: "se", name: "Sweden", tz: "Europe/Stockholm",
      companies: ["Klarna", "Tink", "Trustly", "Anyfin"] },
    { id: "ee", name: "Estonia", tz: "Europe/Tallinn",
      companies: ["Wise (Tallinn)", "LHV", "Inbank", "Veriff"] },
    { id: "sg", name: "Singapore", tz: "Asia/Singapore",
      companies: ["Grab Financial Group", "Airwallex", "Nium", "Aspire", "Funding Societies", "Endowus"] },
    { id: "ae", name: "United Arab Emirates", tz: "Asia/Dubai",
      companies: ["Tabby", "Sarwa", "Ziina", "YAP"] },
    { id: "ng", name: "Nigeria", tz: "Africa/Lagos",
      companies: ["Flutterwave", "Paystack", "Moniepoint", "Kuda", "OPay", "PalmPay", "FairMoney", "Carbon", "Interswitch"] },
    { id: "ke", name: "Kenya", tz: "Africa/Nairobi",
      companies: ["M-KOPA", "Safaricom (M-Pesa)", "Tala", "Branch"] },
    { id: "br", name: "Brazil", tz: "America/Sao_Paulo",
      companies: ["Nubank", "PicPay", "Stone", "Creditas", "Banco Inter"] },
    { id: "ca", name: "Canada", tz: "America/Toronto",
      companies: ["Wealthsimple", "KOHO", "Borrowell", "RBC (Borealis AI)"] },
    { id: "in", name: "India", tz: "Asia/Kolkata",
      companies: ["Razorpay", "PhonePe", "CRED", "Paytm", "Zerodha"] },
  ];

  const places = [
    { t: "ADPList", u: "https://adplist.org/", why: "Free platform where professionals volunteer as mentors. Filter by Data Science. The easiest 'yes' you'll get." },
    { t: "DataTalks.Club", u: "https://datatalks.club/", why: "Large free data community with a Slack. Practitioners answer questions and run free courses." },
    { t: "MentorCruise", u: "https://mentorcruise.com/", why: "Paid mentoring. Useful for seeing which data scientists enjoy mentoring; many also post on LinkedIn." },
    { t: "Kaggle discussions", u: "https://www.kaggle.com/discussions", why: "People who write helpful notebooks on credit/fraud datasets are often mid-level and generous." },
    { t: "Luxembourg House of Financial Technology", u: "https://www.lhoft.com/", why: "Luxembourg's fintech hub. Its events and member startups list people to follow." },
    { t: "Copenhagen FinTech", u: "https://copenhagenfintech.dk/", why: "Denmark's fintech hub; members and event speakers are good prospects." },
  ];

  // Placeholders: {first} {company} {postTopic} {myName} {oneLiner} {week} {project} {projectLink} {ask} {win}
  const templates = [
    { id: "connect", stage: "Connection request", limit: 200,
      when: "After 30+ days of engaging and at least 4 real comments. Tuesday–Thursday, 8–10am their time.",
      body: "Hi {first}, I've learned a lot from your posts on {postTopic} over the past few weeks. I'm building fintech ML projects and would value being connected. {myName}" },
    { id: "connect-b", stage: "Connection request (alt.)", limit: 200,
      when: "Use if they replied to one of your comments.",
      body: "Hi {first}, thanks for replying to my comment on your {postTopic} post. It changed how I approached my own project. Would love to stay connected. {myName}" },
    { id: "accepted", stage: "After they accept", limit: 0,
      when: "1–3 days after they accept. Lead with admiration and value; make a small ask, not 'will you be my mentor'.",
      body: "Thanks for connecting, {first}.\n\nYour post on {postTopic} stuck with me. [One sentence on the exact idea you took from it.] I applied it in my own work: [what you did with it].\n\nA bit about me: I'm {oneLiner}. I'm {week} weeks into a 12-month plan and recently built {project} ({projectLink}).\n\nI know your time is valuable, so a small ask: would you be open to a 15-minute call in the next few weeks? If a call is too much, I'd be just as grateful for your view on one question: {ask}\n\nEither way, thank you for sharing your work so openly.\n{myName}" },
    { id: "follow1", stage: "Follow-up (7 days)", limit: 0,
      when: "7 days after your message with no reply. One follow-up only, and add something new.",
      body: "Hi {first}, a quick and pressure-free follow-up. Since my last note I've {win}. If a 15-minute chat ever fits your schedule I'd be grateful; if not, I'll keep learning from your posts." },
    { id: "thanks", stage: "Thank-you after a call", limit: 0,
      when: "Within 24 hours of the call.",
      body: "Thank you for your time today, {first}. Your advice on [topic] is going straight into my plan. This week I'll [specific action].\n\nI'll share how it goes. {myName}" },
    { id: "ask", stage: "The mentorship ask", limit: 0,
      when: "After 1–2 good conversations, once you've acted on their advice and reported back.",
      body: "Hi {first}, I took your advice on [topic] and [result, with a link if possible].\n\nTalking with you has helped more than any course. Would you be open to a short check-in once a month? I'll come prepared every time: a written update, what I did with your last advice, and one specific question, so it's an easy 20 minutes for you.\n\nNo worries at all if the timing isn't right. {myName}" },
    { id: "monthly", stage: "Monthly mentor update", limit: 0,
      when: "Once a month to every mentor and warm contact. This is what turns a single call into a mentor.",
      body: "Hi {first}, my monthly update (2-minute read):\n\n• Shipped: {win}\n• Learned: [one concept]\n• Stuck on: [one problem]\n• Your last advice: [what I did with it]\n\nOne question: {ask}\n\nThank you for being part of this. {myName}" },
    { id: "email", stage: "Email (if LinkedIn goes quiet)", limit: 0,
      when: "Only after a LinkedIn follow-up got no reply, and only to a verified work email. Subject: \"Your {postTopic} post + one question from a fintech ML learner\"",
      body: "Hi {first},\n\nI've followed your LinkedIn posts on {postTopic} for a while. They've shaped how I'm learning. I'm {oneLiner}, and I recently built {project} ({projectLink}).\n\nI have one focused question I think you're uniquely placed to answer: {ask}\n\nA two-line reply would mean a lot. Thank you for sharing your work.\n\n{myName}" },
  ];

  const commentFormula = [
    { k: "Anchor", v: "Quote or name the one specific point you're reacting to. It proves you read the post." },
    { k: "Add", v: "Add something new: a result from your weekly fintech problem, a counter-example, or a resource." },
    { k: "Ask", v: "End with a genuine question they'd enjoy answering. Questions get replies; replies build familiarity." },
  ];
  const commentExamples = [
    "\"Your point about PR-AUC over ROC-AUC for fraud hit home. On the ULB card dataset this week, my ROC-AUC was 0.97 but PR-AUC only 0.71. Do you set thresholds on precision targets or on an alert budget for analysts?\"",
    "\"Interesting that you monitor PSI monthly. I just computed it on Lending Club 2015 vs 2018 and DTI drifted most (0.31). When a feature drifts like that, do you retrain or recalibrate first?\"",
    "\"The reason-codes example is so useful. I'm generating SHAP-based reason codes for a Home Credit model and struggling to word them for customers. Do you map SHAP features to a fixed list of approved reasons?\"",
  ];
  const callQuestions = [
    "What does a typical week look like for a data scientist on your team?",
    "Which skill made the biggest difference in your first two years?",
    "Looking at my latest project, what would make it stronger for a fintech hiring manager?",
    "What mistake do junior data scientists in fintech make most often?",
    "If you were starting again today, what would you learn in the next 3 months?",
    "Is there anyone else you think I should talk to?",
  ];
  const fitCriteria = [
    { id: "level", t: "2–8 years of experience (not Head/Director/VP)" },
    { id: "fintech", t: "Works at a fintech, bank or payments company" },
    { id: "posts", t: "Posts or comments at least monthly" },
    { id: "replies", t: "Replies to comments on their posts" },
    { id: "mentors", t: "Mentions mentoring, ADPList, teaching or community work" },
    { id: "path", t: "Career path you'd like to follow (similar background or country move)" },
  ];

  window.NETWORK = { markets, places, templates, commentFormula, commentExamples, callQuestions, fitCriteria };
})();
