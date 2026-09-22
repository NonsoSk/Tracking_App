/*
 * Practice & assessment for every week:
 *  - drills: short, hands-on exercises on this week's skills (fintech flavoured)
 *  - quiz: self-graded questions with answers (also reused for spaced review)
 *  - carry: a carry-over challenge that REQUIRES last week's skills + this week's
 */
(function () {
  const P = (n, drills, quiz, carryTitle, carryScenario, carryTasks) => ({
    n, drills, quiz: quiz.map(([q, a]) => ({ q, a })), carry: { title: carryTitle, scenario: carryScenario, tasks: carryTasks },
  });

  const practice = [
    // ---------------- Phase 1 ----------------
    P(1, [
      "Store your monthly allowance, rent and food spend in variables. Print what's left with an f-string, to 2 decimals.",
      "Convert 150,000 in your local currency to USD at today's rate. Print both with thousands separators: f\"{x:,.2f}\".",
      "Simple vs compound interest on $2,000 at 7% for 3 years: P·r·t vs P·(1+r)^t − P. Print the difference.",
      "Ask for a 16-digit card number with input() and print only the last 4 digits (s[-4:]) as \"•••• 6467\".",
      "Print type() of 10, 10.0, \"10\" and True. Then compare \"10\" + \"10\" with 10 + 10 and explain it in a comment.",
      "Split a $86.40 restaurant bill with a 15% tip between 3 people, rounded to cents.",
    ], [
      ["What does int(\"12.5\") do?", "It raises ValueError. Convert with float(\"12.5\") first, then int() if you want to truncate."],
      ["What are 7 // 2 and 7 % 2?", "3 (floor division) and 1 (remainder)."],
      ["Why is 0.1 + 0.2 == 0.3 False, and what does it mean for money?", "Floats are binary approximations. Round for display, and store money as integer cents or decimal.Decimal."],
      ["What does f\"{1234567.891:,.2f}\" print?", "1,234,567.89"],
    ], "Savings goal vs borrowing", "A student wants $3,000 for a laptop. Should they save for it or take a loan? Combine the first half of this week (variables, input) with the second (formulas, formatting).", [
      "Ask for the goal, monthly saving and savings interest rate",
      "Future value after 12 months of saving: PMT·((1+r)^12 − 1)/r with r = annual rate/12",
      "Monthly payment if they borrowed the $3,000 instead (your loan calculator, 18% for 12 months)",
      "Print a 3-line comparison: amount saved, loan cost, and the difference in interest",
    ]),

    P(2, [
      "ATM check: reject a withdrawal that isn't a multiple of 20 or exceeds the balance, and print the reason.",
      "Loop over 12 months: a savings balance that earns 1% a month plus a $100 deposit. Print each month.",
      "while loop: months to clear a $5,000 card balance at 24% APR, paying $200 a month.",
      "FizzBuzz, fintech edition: for 1–50 print FEE if divisible by 3, TAX if by 5, FEE+TAX if both.",
      "PIN checker: 3 attempts with while and break; print \"Card locked\" after 3 wrong tries.",
      "Tiered transfer fee: up to $100 free, $100–1,000 at 1%, over $1,000 at 0.5% capped at $20.",
    ], [
      ["Difference between several if statements and an if/elif chain?", "elif stops at the first true condition; separate ifs test every one."],
      ["What does range(1, 13) produce?", "The numbers 1 to 12, which is handy for months."],
      ["When is while better than for?", "When you don't know how many repetitions you need, e.g. until a balance reaches zero."],
      ["What prints? for i in range(3): if i == 1: continue; print(i)", "0 and 2."],
    ], "Credit card payoff advisor", "A bank app tells customers how long their card debt will take to clear. You need Week 1's input and formatting plus this week's loops and decisions.", [
      "Input balance, APR and monthly payment (Week 1)",
      "Loop month by month adding interest and subtracting the payment (Week 2)",
      "If the payment is less than or equal to the first month's interest, warn \"You will never pay this off\" and stop",
      "Print months needed and total interest, formatted as currency; compare paying the 2% minimum vs a fixed $200",
    ]),

    P(3, [
      "List of 10 daily card spends: print max, min, sum, average and a descending sort.",
      "Dict {currency: rate}: convert $250 into every currency in a loop.",
      "Sets: find customers who used both the mobile app and the website (intersection), and app-only users (difference).",
      "List comprehensions: keep transactions above $50; apply a 1.5% fee to each amount.",
      "List of (date, amount) tuples: unpack them in a for loop to print a mini statement.",
      "Dict of lists: group transactions by merchant category.",
    ], [
      ["List vs tuple?", "Lists can change; tuples can't, so they suit fixed records and dict keys."],
      ["d.get(\"x\", 0) vs d[\"x\"]?", "get returns the default when the key is missing; d[\"x\"] raises KeyError."],
      ["What is {1, 2, 2, 3}?", "{1, 2, 3}. Sets drop duplicates."],
      ["What is [x * 2 for x in range(4) if x % 2 == 0]?", "[0, 4]"],
    ], "Fraud rules on a transaction list", "A card issuer runs simple rules before any model. Last week's if/elif and loops now run over this week's data structures.", [
      "For each transaction dict, flag \"review\" if the amount is over $1,000 (Week 2 decisions)",
      "Flag it if the country isn't in the customer's set of usual countries (Week 3 sets)",
      "Flag a merchant that appears 3+ times for the same card (Week 3 dict counting)",
      "Store results as {status: [transaction ids]} and print a summary",
    ]),

    P(4, [
      "compound_interest(principal, rate, years, n=12) with a default; call it with keyword arguments.",
      "iban_length_ok(iban): check the length from a dict (DE 22, DK 18, LU 20, GB 22, NL 18).",
      "luhn_valid(card): implement the Luhn check. 4539148803436467 is valid; change the last digit and it isn't.",
      "withdraw() raises ValueError when the amount exceeds the balance; catch it and print a friendly message.",
      "random + datetime: generate 5 six-digit OTP codes, each with an expiry time 5 minutes from now.",
      "Custom exception DailyLimitExceeded, raised when a day's transfers pass $2,000.",
    ], [
      ["return vs print?", "return hands a value back to the caller; print only shows it on screen."],
      ["What happens to a variable created inside a function after it returns?", "It's local, so it disappears."],
      ["Why catch except ValueError instead of a bare except?", "A bare except hides unrelated bugs, even typos."],
      ["What's wrong with def add(tx, items=[])?", "The default list is shared between calls. Use items=None and create a new list inside."],
    ], "Reusable transaction toolkit", "Turn last week's list-and-dict code into functions a team could reuse, with proper errors.", [
      "total_by_category(txs) → dict (Week 3 dicts inside a Week 4 function)",
      "find_duplicates(txs) → set of repeated ids",
      "top_merchants(txs, n=3) using sorted() with key=lambda",
      "Each function raises TypeError/ValueError on bad input; write 3 calls that trigger and catch them",
    ]),

    P(5, [
      "Write 20 fake transactions to transactions.csv with csv.DictWriter, then read them back with DictReader.",
      "Save a currency-rates dict to rates.json, reload it, change one rate and save again.",
      "Loan due 2026-07-15, paid 2026-08-02: how many days late? Use datetime.",
      "Parse \"03/10/2026\" as European day-first and as US month-first with strptime. Are they the same date?",
      "pathlib: list every .csv file in a folder with its size in KB.",
      "Group statement lines by month (YYYY-MM) using strftime.",
    ], [
      ["Why use with open(...)?", "The file closes automatically, even if an error happens."],
      ["json.dump vs json.dumps?", "dump writes to a file; dumps returns a string."],
      ["What type are values from csv.DictReader?", "Always strings. Convert amounts with float() and dates with strptime."],
      ["What is date(2026, 1, 31) + timedelta(days=30)?", "2026-03-02 (February 2026 has 28 days)."],
    ], "Late-fee engine", "A lender charges late fees from a CSV of loans. You need last week's functions and errors plus this week's files and dates.", [
      "Read loans.csv (id, due_date, paid_date, amount) with DictReader",
      "late_fee(days_late): $0 for up to 5 days, then $15, plus 1% of the amount after 30 days (Week 4 function)",
      "Rows with bad dates raise ValueError; catch them and write them to errors.csv",
      "Save fees per loan to late_fees.json with a total",
    ]),

    P(6, [
      "Transaction class with amount, merchant and date, plus a readable __repr__.",
      "Customer class holding a list of accounts, with total_balance().",
      "StudentAccount subclass: no monthly fee, $500 overdraft limit.",
      "Account.from_dict(d) classmethod that builds an account from a JSON row.",
      "Loan class whose schedule() method reuses your Week 2 amortization code.",
      "__str__ that prints a card as \"VISA •••• 6467\".",
    ], [
      ["What is self?", "The specific object the method was called on."],
      ["Inheritance vs composition?", "Inheritance is 'is-a' (SavingsAccount is an Account); composition is 'has-a' (Customer has accounts)."],
      ["When does __init__ run?", "When you create an object, e.g. Account(...)."],
      ["What does super().__init__(...) do?", "Runs the parent class's setup so shared attributes get set."],
    ], "Persist your bank", "A core banking system must survive restarts. Load last week's files into this week's objects, run month-end, and save.", [
      "Load customers and accounts from customers.json into objects with from_dict (Weeks 5+6)",
      "Month-end: apply savings interest and card interest and fees as methods",
      "Write a dated statement CSV per customer (Week 5)",
      "Save the updated state back to JSON; reload it to prove nothing was lost",
    ]),

    P(7, [
      "Create a venv, install requests, and save requirements.txt with pip freeze.",
      "Make 3 commits on a branch called fx-feature and merge it into main.",
      "Frankfurter time series: EUR→USD for the last 30 days; print the min and max and their dates.",
      "Request a fake currency code and handle the error response with a helpful message.",
      "Read the API base URL from an environment variable with os.environ.get and a default.",
      "Write a README with what it does, how to install and how to run.",
    ], [
      ["git add vs git commit?", "add stages changes; commit records a snapshot with a message."],
      ["Why use a virtual environment?", "Each project gets its own package versions, so projects don't break each other."],
      ["HTTP 200, 404, 429 and 500 mean?", "OK, not found, too many requests (slow down), server error."],
      ["Why never commit API keys?", "Bots scan public repos within minutes and abuse keys; use environment variables."],
    ], "Multi-currency account, online", "A wallet app must show balances in live rates but keep working offline. You need last week's classes plus this week's APIs.", [
      "CurrencyConverter class that fetches rates and caches them for 1 hour (Week 6 class + datetime)",
      "Falls back to the last saved rates.json when the API is down (Week 5 files)",
      "Account.balance_in(currency) uses the converter",
      "Commit each step with a clear message and push",
    ]),

    P(8, [
      "3 tests for monthly_payment, including 0% interest (payment = P / n).",
      "pytest.raises: test that transfer raises InsufficientFunds.",
      "A pytest fixture that builds a sample account for several tests.",
      "Break a function on purpose, read the traceback, fix it.",
      "@pytest.mark.parametrize over the 5 transfer-fee tiers from Week 2.",
      "Redo your hardest exercise from Weeks 1–7 from a blank file, without notes.",
    ], [
      ["What should a unit test check?", "One behaviour with a known input and expected output, including edge cases."],
      ["Why test 0% interest?", "The formula divides by r, so it crashes with ZeroDivisionError unless handled."],
      ["What is a fixture?", "Reusable setup (like a sample account) that tests receive as an argument."],
      ["Where do you look first in a traceback?", "The last lines: the error type and the line in your own file."],
    ], "Tested FX wrapper", "Tests must not depend on the internet. Test last week's API code in isolation.", [
      "monkeypatch requests.get to return fake rates; test convert() (Weeks 7+8)",
      "Test that the offline fallback reads rates.json when the API raises an error",
      "Test that a stale cache (over 1 hour old) triggers a refetch",
      "All tests pass with Wi-Fi off",
    ]),

    // ---------------- Phase 2 ----------------
    P(9, [
      "12 monthly returns in an array: cumulative growth with np.cumprod(1 + r).",
      "Boolean mask: loans with PD above 10% and amount above $20k.",
      "Broadcasting: apply 3 interest-rate scenarios to 1,000 balances at once, giving shape (1000, 3).",
      "np.percentile of simulated losses at 95% and 99%.",
      "np.where to label transactions \"high\" or \"normal\".",
      "Time a Python loop vs a vectorised sum over 1 million amounts.",
    ], [
      ["Why is NumPy faster than lists?", "Arrays are typed and contiguous, and operations run as compiled C loops."],
      ["Can you add shape (1000,) to shape (3,)?", "No. Reshape to (1000, 1) first; broadcasting then gives (1000, 3)."],
      ["Why use np.random.default_rng(42)?", "A seed makes simulations reproducible."],
      ["What does arr[arr > 0].mean() compute?", "The mean of the positive values only."],
    ], "Tested risk functions", "A risk team won't use numbers without tests. Combine last week's pytest with NumPy.", [
      "expected_loss(pd, lgd, ead) vectorised over arrays (Week 9)",
      "Raise ValueError if any PD is outside [0, 1] (Week 4 errors)",
      "Tests with np.testing.assert_allclose on a hand-calculated example (Week 8)",
      "Test that a 10,000-scenario simulation with a fixed seed gives the same VaR twice",
    ]),

    P(10, [
      "Load the credit default data; print shape, dtypes and memory usage.",
      "Rename PAY_0…PAY_6 to readable names with a dict comprehension.",
      "Filter customers under 30 with a limit above NT$200,000.",
      "value_counts(normalize=True) of default by EDUCATION.",
      "New column utilisation = BILL_AMT1 / LIMIT_BAL; show the top 10.",
      "sort_values by default flag, then by limit.",
    ], [
      ["loc vs iloc?", "loc selects by label; iloc by position."],
      ["Why does df[df.a > 5 & df.b < 3] fail?", "Operator precedence. Write (df.a > 5) & (df.b < 3)."],
      ["Series vs DataFrame?", "A Series is one labelled column; a DataFrame is a table of them."],
      ["What does describe() skip by default?", "Non-numeric columns."],
    ], "Simulate from real data", "Estimate risk for a new portfolio using real default rates. You need last week's NumPy simulation plus this week's pandas.", [
      "Default rate per age band with pd.cut (Week 10)",
      "Create 1,000 new customers with an age mix and look up their PDs",
      "Monte Carlo with NumPy: 10,000 scenarios of defaults (Week 9)",
      "Report expected defaults and a 95% range",
    ]),

    P(11, [
      "Count missing values per column; drop rows missing Customer ID, fill Description with \"UNKNOWN\".",
      "groupby('Country').agg(revenue=('Revenue', 'sum'), orders=('Invoice', 'nunique')).",
      "Merge a small country→region table onto transactions.",
      "Extract month and weekday from InvoiceDate. Which weekday has the most revenue?",
      "pivot_table of revenue by month × country (top 5 countries).",
      "Find customers whose first purchase was in December 2010 (a cohort).",
    ], [
      ["merge how='left' vs how='inner'?", "left keeps every left row; inner keeps only matches."],
      ["Why check row counts after a merge?", "Duplicate keys multiply rows silently."],
      ["agg vs transform in groupby?", "agg gives one row per group; transform returns values aligned to the original rows."],
      ["Is NaN == NaN True?", "No. Use isna()."],
    ], "Bill growth and default", "Do customers whose card bills grow fast default more? You need last week's filtering plus this week's reshaping and groupby.", [
      "melt BILL_AMT1–6 into long format (customer, month, bill) (Week 11)",
      "groupby customer: growth from month 6 to month 1",
      "Merge growth back onto the customer table (Week 11 merge)",
      "Compare default rates for customers with >50% bill growth vs the rest (Week 10 filtering)",
    ]),

    P(12, [
      "Histogram of loan amounts with a log x-axis.",
      "Bar chart of default rate by age band, with value labels on the bars.",
      "Boxplot of monthly income by delinquency status.",
      "Line chart of monthly revenue (Week 11) with an annotation on the peak month.",
      "Correlation heatmap showing only the lower triangle.",
      "Take a cluttered default chart and redesign it: no chartjunk, a title that states the insight.",
    ], [
      ["Which chart for categories, distributions and trends?", "Bar; histogram or box; line."],
      ["Why start a bar chart's axis at zero?", "Bar length is the value; a cut axis exaggerates differences."],
      ["What should a chart title say?", "The insight, e.g. \"Defaults triple above 80% utilisation\"."],
      ["Does a correlation of 0.02 mean no relationship?", "No linear relationship; there could still be a non-linear one."],
    ], "RFM dashboard page", "Marketing wants one page that explains your customer segments. Chart last week's RFM table.", [
      "One figure with 4 subplots from your Week 11 RFM table",
      "Segment sizes and revenue share per segment",
      "Recency distribution and monthly revenue of Champions vs At Risk",
      "A headline title for each subplot, saved as a PNG for LinkedIn",
    ]),

    P(13, [
      "SELECT the 10 largest transactions.",
      "COUNT and SUM of amount by transaction type.",
      "HAVING: accounts with more than 5 transactions.",
      "Create a small customers table; LEFT JOIN to find customers with no transactions.",
      "WHERE with IN and BETWEEN.",
      "Write the same query in pandas and in SQL and check the results match.",
    ], [
      ["WHERE vs HAVING?", "WHERE filters rows before grouping; HAVING filters groups after."],
      ["COUNT(*) vs COUNT(col)?", "All rows vs non-null values in that column."],
      ["INNER vs LEFT JOIN?", "Only matching rows vs all left rows, with NULLs where there's no match."],
      ["Logical order of a SELECT query?", "FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT."],
    ], "SQL-powered fraud charts", "A fraud lead wants to see when fraud happens. Query with this week's SQL, chart with last week's skills.", [
      "SQL: fraud count and rate by type and by step % 24 (hour of day)",
      "Load results with pd.read_sql",
      "Two charts: fraud rate by hour, fraud amount by type (Week 12)",
      "Insight titles, and one recommendation for staffing the fraud team",
    ]),

    P(14, [
      "ROW_NUMBER: each account's first transaction.",
      "LAG: time since the previous transaction per account.",
      "Running SUM of amounts per account.",
      "CTE: daily totals, then the average daily total.",
      "RANK merchants by revenue within each country (Online Retail in SQLite).",
      "CASE WHEN: bucket amounts into small, medium and large.",
    ], [
      ["GROUP BY vs a window function?", "GROUP BY collapses rows; a window function keeps every row."],
      ["What does PARTITION BY do?", "Restarts the calculation for each group, e.g. each account."],
      ["ROWS BETWEEN 6 PRECEDING AND CURRENT ROW?", "A 7-row moving window."],
      ["RANK vs DENSE_RANK?", "RANK leaves gaps after ties (1,1,3); DENSE_RANK doesn't (1,1,2)."],
    ], "Account-drained alert", "Fraudsters empty accounts in one go. Last week's joins and aggregates meet this week's window functions.", [
      "LAG over each origin account's balance: find transactions that took it from >$1,000 to $0 (Week 14)",
      "Share of these that are fraud",
      "JOIN to your Week 13 list of top fraud-receiving accounts: how many drained accounts paid them?",
      "Write it as a single query using CTEs",
    ]),

    P(15, [
      "Download BTC-USD and SPY; compare daily volatility.",
      "Resample daily prices to monthly returns.",
      "50- and 200-day moving averages; find the crossover dates.",
      "Log vs simple returns over one year; show that log returns add up.",
      "Correlation matrix of 5 assets' returns.",
      "Download a FRED series (e.g., FEDFUNDS) and plot it next to a bank stock.",
    ], [
      ["How do you annualise daily volatility?", "Multiply by √252 (trading days)."],
      ["Why use log returns?", "They add over time and are more symmetric."],
      ["Sharpe ratio?", "(Portfolio return − risk-free rate) / portfolio volatility."],
      ["Max drawdown?", "The largest peak-to-trough fall in value."],
    ], "Rolling risk in SQL", "Many banks compute risk metrics in the database. Rebuild this week's pandas metrics with last week's window functions.", [
      "Load prices into SQLite",
      "Daily returns with LAG (Week 14)",
      "20-day moving average and moving volatility with window functions",
      "Verify against pandas rolling() to 6 decimals (Week 15)",
    ]),

    P(16, [
      "Write the business question and 3 sub-questions before touching the data.",
      "Clean dates and company names in the CFPB data.",
      "SQL: top 10 issues for 'Credit card' complaints.",
      "Month-over-month complaint growth by company.",
      "One clear chart per sub-question.",
      "A 150-word executive summary that opens with the answer.",
    ], [
      ["What goes in an analysis README?", "Question, data source, method, findings, limitations, how to run."],
      ["Company A has more complaints than B. Is A worse?", "Not necessarily: normalise by customers or market share."],
      ["Why state limitations?", "Complaints are self-reported and unverified; honesty builds trust."],
      ["First line of an executive summary?", "The answer or key finding."],
    ], "Complaints vs stock performance", "Investors watch regulator data. Combine last week's market data with this week's complaints analysis.", [
      "Monthly complaint counts for Capital One (COF), SoFi (SOFI) and Affirm (AFRM) (Week 16)",
      "Monthly stock returns from yfinance (Week 15)",
      "Correlate complaint growth with returns and chart both",
      "Write why correlation here does not mean causation",
    ]),

    // ---------------- Phase 3 ----------------
    P(17, [
      "Mean vs median of PaySim amounts. Why are they so different?",
      "Binomial: P(3 or more defaults among 20 loans) with PD 5%.",
      "Poisson: average 4 chargebacks a day; P(more than 8 tomorrow)?",
      "Normal: daily return mean 0.05%, sd 1.2%; P(a loss worse than −3%)?",
      "Set an alert at the 99th percentile of transaction amounts; how many alerts a day?",
      "Simulate 10,000 days of chargebacks and compare with the Poisson formula.",
    ], [
      ["What does P(A|B) mean?", "The probability of A given that B happened."],
      ["Are two borrowers' defaults independent in a recession?", "No. They're correlated through the economy, which is why portfolio risk is higher than the naive estimate."],
      ["Mean or median for income?", "Median. Income is skewed and the mean is pulled up by a few high earners."],
      ["What is the base-rate fallacy?", "Ignoring how rare something is (like fraud) when judging a test result."],
    ], "Complaint probabilities", "Regulators ask which firms respond late. Apply this week's conditional probability to last week's CFPB data.", [
      "P(untimely response | company) for 5 companies (Weeks 16+17)",
      "P(company | untimely response)",
      "Explain in plain words why these two numbers differ, using Bayes' theorem",
      "Chart both side by side",
    ]),

    P(18, [
      "Bootstrap a 95% confidence interval for the average transaction amount.",
      "t-test: spend of app users vs web users (Online Retail or simulated).",
      "Chi-square: default vs education level.",
      "Sample size to detect a 1-point change in default rate from 5%.",
      "Run 20 t-tests on random noise. How many are 'significant' at 0.05?",
      "Write one result sentence a manager would understand.",
    ], [
      ["What is a p-value?", "The probability of results at least this extreme if there were truly no effect."],
      ["What does a 95% confidence interval mean?", "If we repeated the study many times, about 95% of such intervals would contain the true value."],
      ["Type I vs Type II error for a fraud rule?", "Type I: flagging a good customer. Type II: missing real fraud."],
      ["Why not peek at an A/B test daily and stop when p < 0.05?", "It inflates false positives. Fix the sample size first."],
    ], "Is the new fraud rule better?", "The old rule caught 45 of 60 frauds in week A; the new rule caught 58 of 70 in week B. You need last week's Bayes plus this week's tests.", [
      "Two-proportion z-test on detection rates (Week 18)",
      "95% CI for the difference",
      "With fraud at 0.2% and a 2% false-alert rate, compute P(fraud | alert) for each rule (Week 17)",
      "Recommend: switch or not, in 3 sentences",
    ]),

    P(19, [
      "Dot product: portfolio return = w · r.",
      "Matrix multiply: convert balances in 3 currencies with a rate matrix.",
      "Build a covariance matrix from returns; check it's symmetric.",
      "np.linalg.solve: a 3-equation budget problem.",
      "Eigenvalues of the covariance matrix: are they all positive?",
      "Standardise the Taiwan PAY columns, then run PCA.",
    ], [
      ["Shape rule for A @ B?", "(m, n) @ (n, p) gives (m, p)."],
      ["What's on the diagonal of a covariance matrix?", "Each variable's variance."],
      ["What does PCA maximise?", "The variance captured by each component."],
      ["Why standardise before PCA?", "Otherwise large-scale features dominate."],
    ], "Is diversification real?", "A robo-advisor claims its minimum-variance portfolio is safer. Test it with last week's statistics.", [
      "Minimum-variance weights from Week 19",
      "Bootstrap daily returns to get a 95% CI for each portfolio's volatility (Week 18)",
      "Do the intervals overlap?",
      "Write the verdict for a client in plain English",
    ]),

    P(20, [
      "Derivative of (y − w·x)² by hand, then check numerically with a tiny h.",
      "Gradient descent to minimise f(x) = (x − 3)².",
      "Gradient descent with 2 features on a 10-row toy dataset.",
      "Plot loss curves for 3 learning rates.",
      "Mini-batch vs full-batch gradient descent on 30,000 rows: compare speed.",
      "Add an L2 penalty to the loss and watch the weights shrink.",
    ], [
      ["Which way does the gradient point?", "Towards steepest increase, so step the opposite way."],
      ["What happens with too large a learning rate?", "The loss oscillates or explodes."],
      ["Why scale features for gradient descent?", "Uneven scales make it zig-zag slowly."],
      ["Can linear-regression MSE have bad local minima?", "No. It's convex, with one global minimum."],
    ], "Closed form vs gradient descent", "Two ways to fit the same model. Use last week's linear algebra and this week's gradient descent.", [
      "Solve w = (XᵀX)⁻¹Xᵀy with NumPy (Week 19)",
      "Fit the same data with your gradient descent (Week 20)",
      "Compare weights and time both on 30,000 rows",
      "Explain when gradient descent wins (millions of features or rows)",
    ]),

    // ---------------- Phase 4 ----------------
    P(21, [
      "train_test_split with random_state; check shapes.",
      "DummyRegressor baseline MAE.",
      "LinearRegression: print coefficients next to feature names.",
      "Ridge over an alpha grid; plot validation MAE vs alpha.",
      "Residual plot. Is there a pattern?",
      "Predict the rate for a made-up applicant.",
    ], [
      ["Why keep a test set?", "To get an honest estimate on data the model never saw."],
      ["MAE vs RMSE?", "RMSE punishes big errors more."],
      ["What does R² = 0.6 mean?", "The model explains 60% of the variance in the target."],
      ["Ridge vs Lasso?", "Ridge shrinks coefficients; Lasso can set some to exactly zero."],
    ], "Your gradient descent vs scikit-learn", "Prove you understand what .fit() does.", [
      "Run your Week 20 gradient descent on the same scaled Lending Club features",
      "Compare MAE and coefficients with LinearRegression and SGDRegressor (Week 21)",
      "Explain any differences",
      "Plot all three models' predictions against the true rate",
    ]),

    P(22, [
      "Confusion matrix at thresholds 0.3, 0.5 and 0.7.",
      "Calculate precision and recall by hand from one confusion matrix.",
      "ROC curve and AUC.",
      "PR curve, compared with the baseline default rate.",
      "class_weight='balanced': what happens to recall?",
      "Interpret coefficients as odds ratios with exp(β).",
    ], [
      ["Precision vs recall in lending?", "Precision: of those you declined, how many would have defaulted. Recall: of all defaulters, how many you caught."],
      ["What does AUC = 0.5 mean?", "No better than random."],
      ["Why isn't 0.5 the right threshold?", "The costs of the two errors differ and classes are imbalanced."],
      ["exp(β) = 1.3 means?", "30% higher odds of default per one-unit increase."],
    ], "Rate and decision together", "A lender prices and approves in one step. Use last week's regression plus this week's classifier.", [
      "Predict each applicant's interest rate (Week 21 model)",
      "Predict each applicant's PD (Week 22 model)",
      "Expected profit = (1 − PD) × interest earned − PD × loss",
      "Approve when profit > 0; report the approval rate and total expected profit",
    ]),

    P(23, [
      "OneHotEncoder(handle_unknown='ignore').",
      "SimpleImputer(strategy='median', add_indicator=True).",
      "ColumnTransformer with separate numeric and categorical steps.",
      "Show leakage: scale before splitting vs inside the pipeline; compare CV scores.",
      "cross_val_score with StratifiedKFold.",
      "Save the pipeline with joblib and reload it.",
    ], [
      ["What is data leakage?", "Information in training that wouldn't be available at prediction time."],
      ["Why fit scalers and imputers on training data only?", "Test data statistics would leak into training."],
      ["Why stratified folds?", "Each fold keeps the same default rate."],
      ["Options for a 5,000-level categorical feature?", "Frequency or target encoding (inside CV), or grouping rare levels."],
    ], "Cost-optimal pipeline", "Choose the threshold honestly, on out-of-fold predictions.", [
      "Get out-of-fold probabilities with cross_val_predict on your Week 23 pipeline",
      "Run the Week 22 cost search on them",
      "Compare with a threshold chosen on the training data: which is more honest?",
      "Report expected cost per 1,000 applications",
    ]),

    P(24, [
      "Trees with max_depth 2–10: plot train vs validation AUC.",
      "export_text on a depth-3 tree.",
      "Random forest with 50, 200 and 500 trees: does AUC keep improving?",
      "Permutation importance vs impurity importance.",
      "Partial dependence plot for income.",
      "OOB score vs cross-validated score.",
    ], [
      ["What does Gini impurity measure?", "How mixed the classes are in a node (0 = pure)."],
      ["Why does a random forest beat one tree?", "Averaging many decorrelated trees reduces variance."],
      ["What's the bias in impurity importance?", "It favours features with many unique values."],
      ["Sign a tree is overfitting?", "Training AUC near 1 with much lower validation AUC."],
    ], "Pipeline + forest", "Last week's pipeline, this week's model.", [
      "Put RandomForestClassifier inside your Week 23 pipeline",
      "GridSearchCV over max_depth and min_samples_leaf",
      "Compare with logistic regression on the same folds",
      "Permutation importance on the best model",
    ]),

    P(25, [
      "LightGBM with default settings: baseline AUC.",
      "learning_rate × n_estimators trade-off (0.1/200 vs 0.02/1000).",
      "Early stopping on a validation set.",
      "LightGBM's native handling of categorical features.",
      "Gain-based feature importance.",
      "Optuna: 20 tuning trials.",
    ], [
      ["Boosting vs bagging?", "Boosting builds trees one after another to fix errors; bagging builds them independently and averages."],
      ["Why early stopping?", "It stops adding trees once validation stops improving, which prevents overfitting."],
      ["num_leaves vs max_depth in LightGBM?", "num_leaves is the main complexity control; keep it below 2^max_depth."],
      ["A sign boosting is overfitting?", "Training loss keeps falling while validation loss rises."],
    ], "Forest vs boosting head-to-head", "A fair model comparison, as a model risk team would demand.", [
      "Same 5 folds for your Week 24 forest and Week 25 LightGBM",
      "Fold-by-fold AUC table: does one win on every fold?",
      "Compare training and prediction time",
      "Decide which model goes forward, with 3 reasons",
    ]),

    P(26, [
      "PR-AUC of a random model equals the fraud rate. Check it.",
      "SMOTE inside an imblearn Pipeline so it only touches training folds.",
      "Class weights vs scale_pos_weight.",
      "Recall at 80% precision.",
      "Calibration curve before and after isotonic calibration.",
      "Brier score comparison.",
    ], [
      ["Why is SMOTE before splitting a mistake?", "Synthetic points built from test rows leak into training."],
      ["Why PR-AUC over ROC-AUC for rare fraud?", "ROC-AUC looks great from the many easy negatives; PR-AUC shows alert quality."],
      ["What does 'calibrated' mean?", "Among cases scored 0.2, about 20% are actually positive."],
      ["What is the Brier score?", "Mean squared error of the probabilities; lower is better."],
    ], "Tuned and calibrated fraud model", "Tune with last week's methods, then fix this week's imbalance and calibration issues.", [
      "Tune LightGBM with early stopping on the ULB data (Week 25)",
      "Compare scale_pos_weight vs SMOTE by PR-AUC (Week 26)",
      "Calibrate the winner and plot reliability",
      "Expected cost at your chosen threshold",
    ]),

    P(27, [
      "shap.TreeExplainer on your LightGBM model.",
      "Waterfall plot for one declined applicant.",
      "Dependence plot for the top feature.",
      "Map the top 10 features to plain-English reasons.",
      "Approval rate by gender and age group.",
      "Equal-opportunity difference: recall gap between groups.",
    ], [
      ["What do SHAP values for one prediction add up to?", "The prediction minus the average (base) prediction."],
      ["Global vs local explanation?", "What drives the model overall vs why one person got their score."],
      ["Why isn't dropping gender enough for fairness?", "Other features can act as proxies for it."],
      ["What is an adverse action notice?", "The US-required letter telling a declined applicant the main reasons."],
    ], "Explain the fraud alerts", "Fraud analysts need reasons too. Explain last week's model with this week's tools.", [
      "SHAP values for the top 10 alerts from your Week 26 model",
      "Turn each into a reason string: \"Amount 12× usual; new device; night-time\"",
      "Check if any alerts are driven by the Time feature alone. Is that a real risk signal?",
      "Model card section: known limitations",
    ]),

    P(28, [
      "Scale features, then k-means for k = 2…10 with an elbow plot.",
      "Silhouette score for each k.",
      "DBSCAN on 2 features: tune eps.",
      "Dendrogram on 200 sampled customers.",
      "A cluster profile table (means and sizes).",
      "2-D PCA plot coloured by cluster.",
    ], [
      ["Why scale before k-means?", "It uses distances, so large-scale features dominate otherwise."],
      ["What shape of cluster does k-means assume?", "Roughly round, similar-sized clusters."],
      ["What does DBSCAN's eps control?", "The neighbourhood radius for points to count as dense."],
      ["Silhouette score range?", "−1 to 1; higher means better separated."],
    ], "Explain the segments", "Marketing asks what really defines each cluster. Use last week's SHAP.", [
      "Train a classifier to predict your Week 28 cluster labels",
      "SHAP summary per cluster (Week 27)",
      "Write a one-line definition of each persona based on SHAP",
      "Check that the definitions match your profile table",
    ]),

    P(29, [
      "Z-score and IQR outliers on transaction amounts.",
      "IsolationForest: effect of the contamination parameter.",
      "Local Outlier Factor on the same features.",
      "Precision@k: how many of the top 100 scores are real fraud?",
      "Combine two anomaly scores by rank averaging.",
      "Time how long each method takes on 1 million rows.",
    ], [
      ["What does contamination do in IsolationForest?", "It sets the expected share of anomalies, and so the threshold."],
      ["How do you evaluate anomaly detection without labels?", "Precision@k on a small labelled sample, or analyst review."],
      ["Isolation Forest intuition?", "Anomalies are isolated by fewer random splits (shorter paths)."],
      ["Why combine rules and ML?", "Rules catch known patterns instantly; models find new ones."],
    ], "Anomalies within segments", "Normal for one customer type is odd for another. Combine last week's clusters with this week's anomaly detection.", [
      "Cluster PaySim accounts by behaviour (Week 28)",
      "Isolation Forest inside each cluster (Week 29)",
      "Compare precision@1% with a single global model",
      "Which segment hides the most fraud?",
    ]),

    P(30, [
      "Weight of Evidence by hand for one binned variable: ln(%good / %bad).",
      "Information Value for 5 variables.",
      "Monotonic binning for age.",
      "Scorecard scaling: Factor = 20/ln(2); Offset = 600 − Factor·ln(50).",
      "KS statistic between good and bad score distributions.",
      "Gini = 2·AUC − 1 for your scorecard.",
    ], [
      ["IV rules of thumb?", "< 0.02 useless, 0.02–0.1 weak, 0.1–0.3 medium, > 0.3 strong; > 0.5 is suspicious (possible leakage)."],
      ["Why do regulators like scorecards?", "Every point is transparent and monotonic, so decisions are easy to explain."],
      ["What does KS measure?", "The maximum gap between the cumulative score distributions of goods and bads."],
      ["What does 'points to double the odds' = 20 mean?", "Every 20 points higher halves the odds of default."],
    ], "Anomaly flag in the scorecard?", "Odd applications may signal fraud rather than credit risk. Last week's anomaly detection meets this week's scorecard.", [
      "Isolation Forest on application features (Week 29)",
      "Compare scorecard score distributions for anomalous vs normal applicants (Week 30)",
      "Compute the IV of the anomaly flag",
      "Decide: add it to the scorecard, or route to a fraud check?",
    ]),

    P(31, [
      "Out-of-time split: train on older loans, test on the newest.",
      "Profit curve by approval rate.",
      "SHAP reason codes for the challenger.",
      "PSI between training scores and out-of-time scores.",
      "Write the 6 sections of a model card.",
      "Champion vs challenger comparison table.",
    ], [
      ["Out-of-time vs random split?", "Out-of-time mimics the future and reveals drift; random splits are too optimistic."],
      ["Why use profit instead of AUC to choose?", "The business decision is about money, not ranking quality."],
      ["What goes in a model card?", "Purpose, data, performance, fairness, limitations, monitoring plan."],
      ["When should a challenger replace the champion?", "When it's better on out-of-time data, stable, explainable and approved."],
    ], "Blend scorecard and ML", "Can the traditional and ML models work together?", [
      "Logistic regression using the scorecard points (Week 30) and the LightGBM score (Week 31)",
      "Compare AUC and profit: blend vs each model alone",
      "SHAP on the blend: which model dominates?",
      "Recommend champion, challenger or blend",
    ]),

    P(32, [
      "A Streamlit form with sensible default values.",
      "@st.cache_resource to load the model once.",
      "Validate inputs and show clear errors.",
      "A SHAP bar chart for the current applicant.",
      "Deploy on Streamlit Community Cloud.",
      "A 60-second screen recording.",
    ], [
      ["Why cache the model?", "Streamlit reruns the script on every interaction."],
      ["What must never go in a public demo?", "Secrets, API keys and real personal data."],
      ["Why pin versions in requirements.txt?", "So the deployed app matches what you tested."],
      ["How should the app handle a negative income?", "Reject it with a clear message, never a crash."],
    ], "Business mode", "Managers want to see the trade-offs themselves.", [
      "Add a threshold slider to the app",
      "Show live approval rate and expected profit from your Week 31 curve",
      "Show how many applicants move between approve and decline",
      "Redeploy and share the link",
    ]),

    // ---------------- Phase 5 ----------------
    P(33, [
      "seasonal_decompose on the monthly series.",
      "ADF stationarity test before and after differencing.",
      "ACF and PACF plots.",
      "Fit SARIMA; check the residuals look like white noise.",
      "Rolling-origin backtest over 12 months.",
      "Compare with a seasonal naive forecast.",
    ], [
      ["What is stationarity?", "Constant mean and variance over time."],
      ["Why difference a series?", "To remove trend and make it stationary."],
      ["Seasonal period for monthly data?", "12."],
      ["When does MAPE mislead?", "When actual values are near zero."],
    ], "Forecast page in your app", "Add this week's forecast to last week's Streamlit app.", [
      "A Streamlit page showing the SARIMA forecast with intervals",
      "A horizon slider (1–24 months)",
      "Show backtest MAPE alongside",
      "Cache the fitted model",
    ]),

    P(34, [
      "Lag features with groupby().shift().",
      "Rolling means that don't leak: shift(1) before rolling().",
      "TimeSeriesSplit cross-validation.",
      "Holiday and weekday flags.",
      "One model for many series (a series id feature).",
      "Beat the naive forecast.",
    ], [
      ["Why never shuffle time series?", "You'd train on the future."],
      ["How can rolling features leak?", "If the window includes the day you're predicting."],
      ["Recursive vs direct multi-step forecasting?", "Feeding predictions back in vs one model per horizon."],
      ["What is a P10 forecast?", "A value actual sales stay above 90% of the time. Useful for safe lending."],
    ], "Ensemble forecast", "Combine last week's and this week's forecasters.", [
      "Backtest SARIMA (Week 33) and LightGBM (Week 34) on the same windows",
      "Average them",
      "Does the ensemble beat both? Table by horizon",
      "Update the lending decision using the ensemble's P10",
    ]),

    P(35, [
      "Tensor basics: shapes, matmul, .to(device).",
      "Write a linear layer by hand, then with nn.Linear.",
      "Full training loop with train and validation loss.",
      "BCEWithLogitsLoss with pos_weight.",
      "Dropout 0 vs 0.3: effect on overfitting.",
      "Early stopping with a patience of 5.",
    ], [
      ["Why do neural nets need activation functions?", "Without them, stacked layers are just one linear model."],
      ["What are logits?", "Raw scores before the sigmoid or softmax."],
      ["Epoch vs batch?", "One full pass over the data vs one chunk used for one update."],
      ["Sign of overfitting?", "Validation loss rises while training loss falls."],
    ], "Neural forecaster", "Try this week's neural net on last week's forecasting features.", [
      "MLP on your Week 34 lag features",
      "Same TimeSeriesSplit as LightGBM",
      "Compare error and training time",
      "When would you choose the neural net?",
    ]),

    P(36, [
      "Autoencoders with bottlenecks of 2, 8 and 16: effect on reconstruction.",
      "Histogram of reconstruction error: fraud vs normal.",
      "An embedding layer for merchant category.",
      "1-D CNN or LSTM on sequences of 10 transactions.",
      "Train on a Colab GPU and compare speed.",
      "Save and reload the model's state_dict.",
    ], [
      ["Why train an autoencoder on normal data only?", "So it learns normal behaviour and reconstructs fraud badly."],
      ["Embedding vs one-hot?", "Embeddings learn dense similarities and scale to many categories."],
      ["When do sequence models beat trees?", "When the order of events matters and there's lots of data."],
      ["What if the bottleneck is too big?", "The network copies its input and anomalies reconstruct well too."],
    ], "Sequence fraud model", "Does the order of transactions matter? Last week's training loop, this week's sequences.", [
      "Build each account's last-10-transaction sequences from PaySim",
      "LSTM on sequences vs an MLP on aggregate features (Week 35)",
      "PR-AUC for both",
      "Which fraud cases does only the LSTM catch?",
    ]),

    P(37, [
      "Clean complaint text: lowercase, remove XXXX redactions.",
      "TF-IDF with bigrams, min_df = 5.",
      "Multi-class logistic regression.",
      "Top 10 words per product class.",
      "Confusion matrix.",
      "Read 10 misclassified complaints.",
    ], [
      ["What does TF-IDF reward?", "Words frequent in a document but rare across all documents."],
      ["Why add bigrams?", "They capture phrases like \"late fee\" or \"credit report\"."],
      ["Macro vs micro F1?", "Macro weights every class equally; micro weights by volume."],
      ["Should you always remove stop words?", "No. \"not\" changes meaning."],
    ], "Neural vs TF-IDF", "Last week's PyTorch meets this week's text.", [
      "A PyTorch model with an embedding bag over complaint words (Weeks 35–36)",
      "Compare macro-F1 with TF-IDF + logistic regression (Week 37)",
      "Compare training time and explainability",
      "Which would you ship for routing?",
    ]),

    P(38, [
      "A Hugging Face sentiment pipeline on 20 headlines.",
      "Inspect tokenisation of \"BNPL\" and \"chargeback\".",
      "Batch-score Financial PhraseBank with FinBERT.",
      "Sentence embeddings with sentence-transformers.",
      "Cosine-similarity search over complaints.",
      "Zero-shot vs few-shot prompts for classifying complaints.",
    ], [
      ["What is a token?", "A word piece the model reads; long or rare words split into several."],
      ["Attention in one sentence?", "Each word's representation is built by weighing the other words that matter to it."],
      ["Why use RAG?", "Answers come from your documents, and are fresher and less invented."],
      ["How do you reduce hallucinations?", "Retrieve sources, require citations, allow \"I don't know\", and test."],
    ], "Complaint routing v2", "Upgrade last week's router with this week's models.", [
      "Sentence embeddings + logistic regression on complaints (Week 38)",
      "Compare macro-F1 with your Week 37 TF-IDF model",
      "Compare cost per 1,000 complaints (compute or API)",
      "Recommend one, with reasons",
    ]),

    P(39, [
      "Build a directed graph of PaySim transfers.",
      "Degree distribution: who receives from the most senders?",
      "PageRank.",
      "Connected components containing fraud.",
      "Shortest path between two fraud accounts.",
      "Export node features to a DataFrame.",
    ], [
      ["Directed or undirected for payments?", "Directed: money flows one way."],
      ["What does PageRank capture?", "Importance based on receiving from other important nodes."],
      ["What is a connected component?", "A group of nodes linked by some path."],
      ["What is fan-in?", "Many senders paying one account, a mule signal."],
    ], "Investigator case summary", "Fraud investigators write a case file for every ring. Use last week's LLM skills on this week's graph findings.", [
      "Pick one fraud ring (Week 39)",
      "Build a facts table: accounts, amounts, times, degrees",
      "Prompt an LLM to write a case summary using only those facts (Week 38)",
      "Check every sentence against the facts and count errors",
    ]),

    P(40, [
      "Gain chart by decile.",
      "Lift in the top decile.",
      "Profit per decile at €5 per call and €80 per sale.",
      "Drop 'duration' and measure the AUC change.",
      "Calibrate the propensity scores.",
      "Sketch a two-model uplift approach.",
    ], [
      ["What is lift?", "Response rate in a segment divided by the overall rate."],
      ["Why does 'duration' leak?", "Call length is only known after the call, and it already reflects the outcome."],
      ["Propensity vs uplift?", "Who will buy vs who will buy because you called."],
      ["ROI formula for the campaign?", "(Revenue − cost) / cost."],
    ], "Network-aware targeting", "Customers influence friends. Last week's graph skills meet this week's targeting.", [
      "Simulate a referral network over the bank's customers with networkx (Week 39)",
      "Score = propensity × (1 + a share of neighbours' propensity) (Week 40)",
      "Simulate conversions with and without network effects",
      "Does network-aware targeting raise profit?",
    ]),

    // ---------------- Phase 6 ----------------
    P(41, [
      "Restructure a project into src/ and tests/.",
      "Add type hints and run mypy.",
      "Replace print with logging at INFO and DEBUG levels.",
      "Move settings to a YAML config.",
      "Run ruff and fix every warning.",
      "GitHub Actions: run tests on push.",
    ], [
      ["Why use logging instead of print?", "Levels, timestamps, and output to files or monitoring."],
      ["What do type hints give you?", "Earlier bug detection and self-documenting code."],
      ["Why CI?", "Every push is tested automatically, so broken code is caught fast."],
      ["Config vs code?", "Values that change (paths, thresholds) go in config, not code."],
    ], "Package the campaign model", "Turn last week's notebook into a tool.", [
      "A CLI: python -m campaign score --budget 5000 (Week 41 structure)",
      "It loads the Week 40 model and outputs the call list",
      "Tests for the profit calculation",
      "Runs in CI",
    ]),

    P(42, [
      "FastAPI hello world with /health.",
      "A Pydantic request model with constraints (amount > 0).",
      "Load the model once at startup.",
      "A slim Dockerfile.",
      "Run the container and call it with curl.",
      "Measure latency over 1,000 requests.",
    ], [
      ["GET vs POST?", "GET reads; POST sends data (like a transaction to score)."],
      ["What does a 422 from FastAPI mean?", "The request failed validation."],
      ["Image vs container?", "An image is the template; a container is a running instance."],
      ["Why load the model at startup?", "Loading per request makes latency far too high."],
    ], "Serve the package", "The API should reuse last week's package, not copy code.", [
      "The API imports your Week 41 package",
      "Log every request with its latency",
      "Tests using FastAPI's TestClient",
      "CI builds the Docker image",
    ]),

    P(43, [
      "mlflow.log_params and log_metrics in the training script.",
      "Compare runs in the MLflow UI.",
      "Register the best model.",
      "Secrets from environment variables.",
      "Deploy to a free host.",
      "Rollback drill: switch to the previous model version.",
    ], [
      ["Why track experiments?", "To know exactly which settings produced which model."],
      ["What does a model registry add?", "Versions and stages (staging, production)."],
      ["What do you need for reproducibility?", "Code version, data version, environment and random seed."],
      ["Where do secrets live in production?", "In the host's secret manager or environment variables, never in git."],
    ], "Versioned API", "Last week's API should serve a registered model.", [
      "/score returns the model version it used",
      "Load the model by version from the registry",
      "Deploy version 2 and switch back to version 1 with one config change",
      "Write it up in a runbook",
    ]),

    P(44, [
      "PSI by hand: Σ (actual% − expected%) × ln(actual% / expected%).",
      "PSI for every feature.",
      "PSI on the model score.",
      "An Evidently drift report.",
      "Write an alert rule.",
      "Simulate drift by shifting income 20% and check PSI catches it.",
    ], [
      ["PSI thresholds?", "< 0.1 stable, 0.1–0.25 investigate, > 0.25 act."],
      ["Data drift vs concept drift?", "Inputs change vs the relationship between inputs and outcome changes."],
      ["Why monitor predictions before labels arrive?", "Defaults take months to show up; input and score drift show up now."],
      ["Typical retraining triggers?", "PSI above 0.25, a performance drop, or a policy change."],
    ], "Monitoring job", "Monitor last week's deployed service.", [
      "Store incoming requests from the Week 43 API",
      "A daily job computes PSI vs the training data",
      "Log PSI to MLflow",
      "Send an alert (even just a log line) when PSI > 0.25",
    ]),

    P(45, [
      "Write a data contract for incoming transactions.",
      "SQL velocity features: transaction count in the last 1 hour and 24 hours.",
      "Graph features: in-degree and PageRank.",
      "A time-based train/validation/test split.",
      "A feature documentation table.",
      "A dry run of the pipeline on a 1% sample.",
    ], [
      ["Online vs offline features?", "Computed live at request time vs precomputed in batch."],
      ["What is training-serving skew?", "Features computed differently in training and in production."],
      ["Why a time-based split for fraud?", "Fraud patterns change, and the model will face the future."],
      ["What does a feature store do?", "Keeps one definition of each feature for both training and serving."],
    ], "Drift-aware features", "Use last week's monitoring skills before training.", [
      "PSI of every new feature between the first and last month (Week 44)",
      "Flag unstable features",
      "Decide: drop, transform or monitor each one",
      "Record the decisions in the feature table",
    ]),

    P(46, [
      "Baseline LightGBM vs the ensemble.",
      "Threshold for exactly 200 alerts a day.",
      "SHAP reasons for each alert.",
      "Dollars saved vs rules only.",
      "Error analysis by transaction type.",
      "Check prediction latency.",
    ], [
      ["What is an alert budget?", "The number of cases analysts can review a day; it sets the threshold."],
      ["Why rank-average scores in an ensemble?", "The scores are on different scales."],
      ["Why weigh missed fraud by amount?", "A missed $10,000 fraud costs more than a missed $10 one."],
      ["What is error analysis for?", "To find where the model fails and which features to add next."],
    ], "Feature ablation", "Which of last week's features earn their keep?", [
      "Remove velocity features and retrain",
      "Remove graph features and retrain",
      "Dollars saved for each version",
      "Keep only the features that pay for their complexity",
    ]),

    P(47, [
      "Replay the test set as a stream.",
      "A simple queue between producer and scorer.",
      "Streamlit alert dashboard.",
      "docker compose up for the whole system.",
      "Daily PSI panel.",
      "A load test at 50 requests a second.",
    ], [
      ["Batch vs streaming?", "Scoring on a schedule vs scoring each event as it arrives."],
      ["What does idempotent mean here?", "Scoring the same transaction twice gives one result, not two alerts."],
      ["Why Docker Compose?", "It starts several services together with one command."],
      ["Which metrics does a fraud-ops dashboard need?", "Alert volume, precision, fraud caught in dollars, queue age."],
    ], "Live threshold control", "Operations must be able to tune the alert budget.", [
      "Dashboard control for alerts per day",
      "Map it to a threshold using the Week 46 curve",
      "The live stream updates immediately",
      "Log every threshold change for audit",
    ]),

    P(48, [
      "Outline the case study: problem → approach → results → trade-offs → next steps.",
      "Write a 3-minute demo script.",
      "A clean architecture diagram.",
      "README badges (CI, license) and a quickstart.",
      "Launch post draft.",
      "A feedback form for mentors.",
    ], [
      ["What's the best way to show results?", "In business terms: dollars saved, alerts per analyst, recall."],
      ["What should you leave out?", "Every experiment you tried. Keep only what explains the decisions."],
      ["Who is the audience?", "A hiring manager with 2 minutes."],
      ["Why show trade-offs?", "It proves judgement, not just coding."],
    ], "Demo under load", "Show last week's live system in the case study.", [
      "Record the demo while the stream replay runs",
      "Include live metrics screenshots",
      "Explain one real failure you fixed",
      "Publish",
    ]),

    P(49, [
      "5 SQL window-function problems on StrataScratch or LeetCode.",
      "3 pandas live-coding problems in 20 minutes each.",
      "Explain bias vs variance out loud in 60 seconds.",
      "Explain Project 1 in 2 minutes.",
      "Derive logistic regression's loss on paper.",
      "A 45-minute timed mock.",
    ], [
      ["Bias vs variance?", "Too simple and misses patterns vs too complex and fits noise."],
      ["What does regularisation do?", "It penalises complexity to reduce overfitting."],
      ["Give an example of leakage in credit.", "Using 'days past due' measured after the loan was issued."],
      ["How do you handle class imbalance?", "Class weights, resampling within folds, PR-AUC, and a cost-based threshold."],
    ], "Present your project as an interview answer", "Interviewers will dig into last week's case study.", [
      "5-minute STAR answer on Project 2",
      "List 5 likely follow-up questions",
      "Answer them out loud and record yourself",
      "Fix the weakest answer",
    ]),

    P(50, [
      "Define a north-star metric for a neobank.",
      "3 guardrail metrics for an instant-payout feature.",
      "Sample size for the payout experiment.",
      "Estimate the size of the instant-payout market.",
      "3 behavioural STAR stories.",
      "Write a stakeholder email declining a rushed model launch.",
    ], [
      ["North star vs guardrail metric?", "What you're trying to grow vs what must not get worse."],
      ["What is a novelty effect?", "Users react to something new at first, then return to normal."],
      ["Conversion up, fraud up. Ship?", "Only if net value is positive and fraud stays within its guardrail."],
      ["How do you say no to a stakeholder?", "Explain the risk with data and offer an alternative with a timeline."],
    ], "Full-loop mock", "Last week's technical prep plus this week's product sense, in 60 minutes.", [
      "15 min: an SQL window-function question",
      "25 min: the instant-payouts case",
      "15 min: 2 behavioural questions",
      "5 min: your questions for them; then score yourself",
    ]),

    P(51, [
      "Rewrite 3 resume bullets as action + metric + impact.",
      "A GitHub profile README.",
      "Refresh your LinkedIn About and Featured sections.",
      "A personal site on GitHub Pages.",
      "Timebox each sprint day and stick to it.",
      "A 10-minute sprint retrospective.",
    ], [
      ["What makes a strong resume bullet?", "Action, what you built, and a number: \"Cut false alerts 38% by…\"."],
      ["Which repos should you pin?", "Your two projects and your best analysis."],
      ["In what order should projects go?", "The most relevant to the role first."],
      ["What is an ATS?", "Software that screens resumes. Use standard headings and keywords from the job ad."],
    ], "Churn product sense", "Put last week's product thinking behind this week's churn sprint.", [
      "Define churn precisely (e.g., closed or no activity for 60 days)",
      "Design an A/B test for the retention offer",
      "Guardrails: offer cost, margin",
      "Add it to the sprint README",
    ]),

    P(52, [
      "Pull your year's numbers from this tracker: hours, weeks, projects, mentors.",
      "Skills gap analysis against 5 job ads.",
      "Set up an application tracker.",
      "Year-2 plan: choose credit risk, fraud or quant.",
      "Thank-you notes to mentors.",
      "Celebrate. Seriously.",
    ], [
      ["Final check: explain PSI to a non-technical manager.", "It measures how much today's customers differ from the ones the model learned from; above 0.25 means the model may be out of date."],
      ["Final check: when do you prefer PR-AUC over ROC-AUC?", "When positives are rare, like fraud or default in good times."],
      ["Final check: write SQL for a running balance.", "SUM(amount) OVER (PARTITION BY account ORDER BY ts)."],
      ["Final check: explain one SHAP reason code to a customer.", "\"Your credit utilisation of 92% was the biggest factor lowering your score.\""],
    ], "Capstone talk", "Bring the whole year together.", [
      "A 10-minute talk covering Project 1, Project 2 and the churn sprint",
      "Present it live to a mentor",
      "Collect their feedback",
      "Write the year-2 plan using that feedback",
    ]),
  ];

  window.PRACTICE = practice;
})();
