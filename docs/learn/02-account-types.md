# Account types: taxable, IRAs, Roth and the rest

This primer is for you if words like IRA, Roth or 401(k) mean nothing to you yet. It starts from zero. It builds on [the first primer](01-ledger-positions-and-dates.md): what an Account, a Security and a Custodian are, and what a Transaction and its Trade date are. A Household is the group of people a Firm serves together, usually a family.

By the end you'll know:

- why one Household has several Accounts, not one
- the three ways investment money can be taxed, and why it matters so much
- what a Taxable account, a Traditional IRA, a Roth IRA, a 401(k), a Custodial account and a 529 plan are
- how to choose between a Traditional IRA and a Roth IRA, with numbers
- the rules that come with a tax break: how much can go in, when money can come out, and when it must
- who can own each kind of Account, and what happens when an owner dies
- what Cognitive Wealth's code does with all this

Read it before the Household and Account tables are built (#39), and before the world generator makes Accounts (#52). Each section answers one question. It starts with the short answer, then explains it, then shows it with numbers. Words with a capital letter, such as Account or Beneficiary, are defined in [GLOSSARY.md](../../GLOSSARY.md).

All the numbers are for the 2026 tax year, and US only. Tax rules change most years, so each number links to the IRS page or law it comes from.

## How to read this

The primer climbs in three levels. Each level uses only what the levels before it explained.

| Level                 | Parts   | What you get                                                                                     |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| **1. The basics**     | 1 and 2 | Everyday comparisons and small, round numbers: when tax is paid, and each Account type in turn   |
| **2. How it works**   | 3 to 5  | One Household, the Reyes family, followed closely: Traditional or Roth, the rules, who owns what |
| **3. The real world** | 6 and 7 | Moving money between types, the wrinkles the example left out, and what it means for the code    |

On a first read, it's fine to stop after Level 1, take a break, and come back.

Not covered here: tax brackets and how income tax is worked out, Tax lots and Cost basis (phase 2), how Advisory fees are billed (phase 3 has its own primer), and Accounts this project leaves out: trusts, business accounts, and the many smaller retirement plans (SEP, SIMPLE, 403(b), 457(b), HSAs).

## Part 1: Why more than one Account? (Level 1)

### What is a Registration type?

**Short answer:** the legal kind of an Account, which decides who can own it and how its money is taxed.

You already know that a bank offers different kinds of account: a checking account for spending, a savings account for saving. They hold the same dollars, but come with different rules.

Investment Accounts work the same way, with one big difference: the kind of Account changes **how much tax you pay** on what you invest. The kind is called the Account's **Registration type**. You choose it when the Account is opened, and it doesn't change afterwards.

In the first primer, Dana had one Account and we never asked what kind it was. From now on we will.

### Why would one Household have several Accounts?

**Short answer:** because each Registration type has a different tax deal and different rules, and a family usually wants several of those deals at once.

Think of a kitchen. You keep food in a fridge, a freezer and a cupboard, not one big box. Each keeps things for a different length of time, and each has its own rules about what goes in.

A Household's money is similar. A typical family might have:

- an Account they can use any time, for a holiday or a new car
- Accounts for retirement, with a tax break in exchange for leaving the money alone for decades
- an Account for a child's education, with a tax break if the money is spent on school

Each is a separate Account with its own Registration type. The family this primer follows from Part 3, the Reyes family, has two at the Custodian and one more at work (Part 5).

### When do you pay tax on money you invest?

**Short answer:** at one of three moments: on the way in, while it grows, or on the way out. Each Registration type picks a different mix, and that mix is the main reason to choose one over another.

Income tax is a share of what you earn that goes to the government. In this primer, to keep the sums easy, **the tax rate is 20%** of your income. (A simplification: real rates depend on how much you earn. Part 3 shows what happens when the rate changes.)

Follow $1,000 of Dana's salary into three kinds of Account, each explained in Part 2. A Traditional IRA lets Dana subtract the money put in from the income that gets taxed, which is called a _deduction_; that's why it shows no tax on the way in. In each, the investments **double** before Dana takes the money out:

| Step               | Taxable account             | Traditional IRA      | Roth IRA   |
| ------------------ | --------------------------- | -------------------- | ---------- |
| Salary             | $1,000                      | $1,000               | $1,000     |
| Tax on the way in  | 20%: −$200                  | none                 | 20%: −$200 |
| Invested           | $800                        | $1,000               | $800       |
| Doubles to         | $1,600                      | $2,000               | $1,600     |
| Tax on the way out | 15% of the $800 gain: −$120 | 20% of it all: −$400 | none       |
| **Dana keeps**     | **$1,480**                  | **$1,600**           | **$1,600** |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../diagrams/tax-buckets.dark.svg">
  <img alt="Three rows, each starting from $1,000 of salary. Taxable: 20% income tax leaves $800 invested, which doubles to $1,600; 15% tax on the $800 gain leaves $1,480. Traditional IRA: no tax yet, so $1,000 is invested, doubles to $2,000, and 20% income tax on the way out leaves $1,600. Roth IRA: 20% income tax leaves $800 invested, which doubles to $1,600, and no tax on the way out leaves $1,600." src="../diagrams/tax-buckets.light.svg">
</picture>

These are the three **tax buckets**:

1. **Taxable:** tax on the way in, and again on what the money earns. The Taxable account keeps the least. (Part 2 explains the lower 15% rate on gains.)
2. **Tax-deferred:** no tax on the way in, all of it taxed on the way out. "Deferred" means put off until later. A Traditional IRA and most 401(k) money are here.
3. **Tax-free:** tax on the way in, none on the way out, not even on the growth, as long as the withdrawal follows the rules (Part 4). A Roth IRA is here.

Notice that the Traditional IRA and the Roth IRA end at the same $1,600. That's not a coincidence: in this simple example, when the tax rate is the same going in and coming out, they always come out equal. Part 3 shows when they don't.

Why would the government give up tax like this? To encourage people to save for retirement and for education. The tax break is the reward. The price is a set of rules about how much can go in and when it can come out (Part 4).

### Who can own an Account?

**Short answer:** depending on the Registration type, one person, two people together, or a child through an adult who manages it. Anyone can also be named to inherit it.

There are three shapes of ownership:

- **One owner.** The Account belongs to one Person. Every retirement Account has exactly one owner, even for a married couple.
- **Two owners together.** A joint account belongs to two people, usually spouses, at the same time.
- **A child, through an adult.** A child can own money, but can't manage it. An adult, called the custodian, manages it until the child grows up. (This "custodian" is a person, not the Custodian company that holds the Account. The names clash; that's just how the law names them.)

On top of the owners, an Account usually names a **Beneficiary**: the Person who receives it when the owner dies.

In Cognitive Wealth, each of these is an **Account role**: a dated link between a Person and an Account, such as "owner", "joint owner" or "beneficiary".

## Part 2: The Account types, one by one (Level 1)

Each section introduces one Registration type in plain words, with the few numbers that matter. Part 4 collects the rules and their sources.

### What is a Taxable account?

**Short answer:** an ordinary investment Account with no special tax deal: any money can go in, any money can come out, and what it earns is taxed along the way.

This is the closest thing to a bank account. There's no limit on what you put in, and no penalty for taking money out. Its official Registration type is **individual** (one owner) or **joint** (two owners).

The price is tax on what the money earns:

- **Dividends and interest** are taxed as income for the year they're paid. Some dividends, called _qualified_ dividends, "qualify to be taxed at lower capital gain rates" ([IRS Topic 404](https://www.irs.gov/taxtopics/tc404)).
- **Gains** are taxed when you sell. A gain is the difference between what you sold for and what you paid. Buy shares for $800, sell them for $1,600, and the gain is $800.

Gains get a discount if you wait. Sell after holding for **more than one year** and the gain is _long-term_, taxed at a lower rate. Sell within a year and it's _short-term_: "Net short-term capital gains are subject to taxation as ordinary income", that is, like salary ([IRS Topic 409](https://www.irs.gov/taxtopics/tc409)). "Generally, if you hold the asset for more than one year before you dispose of it, your capital gain or loss is long-term" ([IRS Topic 409](https://www.irs.gov/taxtopics/tc409)). Long-term gains on investments like funds and shares are usually taxed at 0%, 15% or 20%, depending on income, and 15% is the common case for a working family. That's where the 15% in Part 1 came from. (Part 4 gives the exact income levels for 2026.)

### What is a Traditional IRA?

**Short answer:** a retirement Account for one person where money goes in before tax and comes out taxed, so you pay the tax decades later, in retirement.

IRA stands for **Individual Retirement Arrangement**. You'll often hear "Individual Retirement Account"; the IRS uses "Arrangement", and the meaning is the same. "Individual" is meant literally: one owner, always.

The IRS describes its two tax advantages: "Contributions you make to an IRA may be fully or partially deductible, depending on which type of IRA you have and on your circumstances; and Generally, amounts in your IRA (including earnings and gains) aren't taxed until distributed" ([IRS Publication 590-A](https://www.irs.gov/publications/p590a)). _Deductible_ means the money you put in is subtracted from your income before tax is worked out, so you pay less tax this year. _Distributed_ means taken out.

When it comes out, it's taxed like salary: "Distributions from traditional IRAs that you include in income are taxed as ordinary income" ([IRS Publication 590-B](https://www.irs.gov/publications/p590b)).

**Example:** Dana puts $1,000 into a Traditional IRA. If the deduction applies, Dana's taxed income this year is $1,000 lower, which at 20% saves $200 of tax now. In thirty years, everything that comes out is taxed.

### What is a Roth IRA?

**Short answer:** the mirror image of a Traditional IRA: money goes in after tax, and in retirement it all comes out tax-free, growth included.

A Roth IRA gives no deduction today. In exchange, qualified withdrawals in retirement are not taxed at all, even though the money may have grown many times over ([IRS Publication 590-B](https://www.irs.gov/publications/p590b), "What Are Qualified Distributions?"). Part 4 explains what makes a withdrawal qualified.

The name isn't an abbreviation. Roth IRAs were created by the Taxpayer Relief Act of 1997 ([Public Law 105-34](https://www.govinfo.gov/content/pkg/PLAW-105publ34/pdf/PLAW-105publ34.pdf), section 302), and are "named for former Senator William Roth" ([Congressional Research Service, RL34397](https://www.congress.gov/crs_external_products/RL/PDF/RL34397/RL34397.36.pdf)).

**Example:** Dana puts $800 of already-taxed salary into a Roth IRA. It grows to $1,600. In retirement, Dana takes out all $1,600 and pays no tax on it.

### What is a 401(k)?

**Short answer:** a retirement Account run through an employer, with much higher limits than an IRA, where money is taken straight out of each paycheck.

The odd name is the section of the tax law that creates it: section 401, paragraph (k) ([26 U.S.C. 401(k)](https://www.law.cornell.edu/uscode/text/26/401)). The employer picks a company to run the plan (often called the recordkeeper), and the employee chooses how much of each paycheck goes in. Many employers add some money of their own, called a match.

Most 401(k) money is tax-deferred, like a Traditional IRA. Many plans also offer a Roth option inside the 401(k).

The big difference is size. For 2026, an employee can put in up to **$24,500** a year, against **$7,500** for an IRA ([IRS news release IR-2025-111](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500)).

For Cognitive Wealth, the important thing is _where_ it is: at the employer's recordkeeper, not at the Firm's Custodian. The Advisor can see it and plan around it, but doesn't manage it. It's a **Held-away asset** (Part 5).

### What is a Custodial account?

**Short answer:** an Account that belongs to a child, managed by an adult until the child grows up.

A child can't open an investment Account alone. So an adult, often a parent or grandparent, opens one _for_ the child, as the child's custodian. These are called UTMA or UGMA accounts, after the two model laws behind them: the Uniform Transfers to Minors Act and the Uniform Gifts to Minors Act.

Two things surprise people:

- **The gift is final.** "Depositing assets into an UTMA/UGMA Account represents an irrevocable transfer from the donor to the beneficiary" ([FINRA Regulatory Notice 20-07](https://www.finra.org/rules-guidance/notices/20-07)). Irrevocable means it can't be taken back. The money is the child's from then on.
- **The child gets control at an age set by each state.** The model law ends the custodianship at 21 for gifts, as quoted in [FINRA Regulatory Notice 20-07](https://www.finra.org/rules-guidance/notices/20-07), footnote 2, but each state sets its own age. After that, the grown-up child can spend it on anything.

There's no special tax break: it's taxed like a Taxable account, but in the child's name. Its Registration type in our code is **custodial**.

### What is a 529 plan?

**Short answer:** an Account for education savings: no tax on the growth, as long as the money is spent on education.

The name is again a section of the tax law, section 529. A 529 plan has an owner (often a parent) and a Beneficiary, the student the money is for. (Careful: for other Accounts, Beneficiary means the Person who inherits it. A 529 plan uses the same word for the student.) Money goes in after tax. It grows without tax, and comes out without tax when it pays for _qualified education expenses_: "tuition, fees, books, supplies, and equipment required for the enrollment or attendance" at a college or similar school, and room and board for students enrolled at least half-time ([26 U.S.C. 529(e)(3)](https://www.law.cornell.edu/uscode/text/26/529)). From 2026, up to $20,000 a year can also pay for school before college, kindergarten to 12th grade ([IRS Topic 313](https://www.irs.gov/taxtopics/tc313)).

Spending it on something else costs extra. Part 6 explains how much.

### The types side by side

| Registration type | Owners                       | Tax bucket                   | Can money come out any time?        | Where it's held, in this project  |
| ----------------- | ---------------------------- | ---------------------------- | ----------------------------------- | --------------------------------- |
| Individual        | one                          | taxable                      | yes                                 | at the Custodian                  |
| Joint             | two                          | taxable                      | yes                                 | at the Custodian                  |
| Traditional IRA   | one                          | tax-deferred                 | before 59½, with a penalty          | at the Custodian                  |
| Roth IRA          | one                          | tax-free                     | your own contributions, yes         | at the Custodian                  |
| 401(k)            | one, through an employer     | mostly tax-deferred          | before 59½, with a penalty          | held away, at the employer's plan |
| Custodial         | a child, managed by an adult | taxable, in the child's name | only for the child's benefit        | at the Custodian                  |
| 529 plan          | an owner, for a Beneficiary  | tax-free for education       | yes, but taxed if not for education | at the Custodian                  |

## Part 3: Traditional or Roth? (Level 2)

From here on, the primer follows one Household: the **Reyes family**, the Household in Cognitive Wealth's world file (#35, added in PR #85). Dana Reyes (born 14 May 1978) is the Primary. Jordan Reyes (born 2 September 1980) is the Co-client. At the Custodian they have:

- **CW-000001**, a joint account, owned by both
- **CW-000002**, Dana's Traditional IRA, with Jordan as Beneficiary

On 2 March 2026, Dana puts $6,000 into the IRA.

### Which one leaves you with more?

**Short answer:** whichever taxes you at the lower rate. A Traditional IRA wins if your tax rate in retirement is lower than today's; a Roth IRA wins if it's higher.

Go back to Part 1's $1,000 with a 20% tax rate today, but change the rate in retirement:

| Tax rate in retirement | Traditional IRA: $2,000 taxed on the way out | Roth IRA: taxed today, nothing later | Better choice |
| ---------------------- | -------------------------------------------- | ------------------------------------ | ------------- |
| 10% (lower than today) | $2,000 − $200 = **$1,800**                   | **$1,600**                           | Traditional   |
| 20% (the same)         | $2,000 − $400 = **$1,600**                   | **$1,600**                           | either        |
| 30% (higher)           | $2,000 − $600 = **$1,400**                   | **$1,600**                           | Roth          |

The Roth column never changes: the tax was paid at today's rate, once. The Traditional column depends on a rate decades away that nobody knows for sure.

So the real question is: **will you pay a higher or lower tax rate later than now?** Some reasons people expect lower: no salary in retirement, so less income to tax. Some reasons people expect higher: a large Traditional IRA that must be paid out (Part 4), or tax laws changing.

Because nobody knows future tax rates, one common approach is to use both, so whatever happens, part of the money got the better deal.

### What does Dana's $6,000 do this year?

**Short answer:** in a Traditional IRA, if the deduction applies, it lowers this year's tax; at a 20% rate, by $1,200.

Dana chose the Traditional IRA. If the $6,000 is deductible (Part 4 notes when it may not be), Dana's taxed income for the year is $6,000 lower: 20% × $6,000 = **$1,200** less tax this year. That $1,200 is the reward now; tax on everything in the IRA is due when it comes out. (Which tax year the $6,000 counts for is less simple than it looks; Part 6 explains.)

Had Dana chosen a Roth IRA, there'd be no saving this year, but nothing to pay later.

## Part 4: The rules that come with a tax break (Level 2)

A tax break comes with rules, so that it's used for retirement and not as a general tax shelter. The sections below take them in turn: how much can go in and who can put it in, when money can come out of a Traditional IRA and of a Roth IRA, when it must come out, and who can use a Roth IRA at all.

### How much can you put in each year?

**Short answer:** for 2026, $7,500 into IRAs, and $24,500 into a 401(k), with a little more allowed from age 50.

The limits and catch-up amounts are from [IRS news release IR-2025-111](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500) (13 November 2025); the totals add the catch-up to the limit, and the IRA's $8,600 is also stated in [IRS Publication 590-A](https://www.irs.gov/publications/p590a):

| 2026 limit                           | Under 50 | 50 or over | 60 to 63 |
| ------------------------------------ | -------- | ---------- | -------- |
| IRAs (Traditional and Roth combined) | $7,500   | $8,600     | $8,600   |
| 401(k), from the employee's pay      | $24,500  | $32,500    | $35,750  |

The extra from age 50 is called a _catch-up_: $1,100 for IRAs and $8,000 for a 401(k), or $11,250 at ages 60 to 63.

Two more rules:

- **You need earnings from work.** "You can open and make contributions to a traditional IRA if you (or, if you file a joint return, your spouse) received taxable compensation during the year" ([IRS Publication 590-A](https://www.irs.gov/publications/p590a)). Compensation means pay for work: wages, salary, self-employment income. Investment income doesn't count.
- **The deduction isn't always allowed.** The Traditional IRA deduction can shrink or disappear for people with higher incomes who also have a retirement plan at work ([IRS Publication 590-A](https://www.irs.gov/publications/p590a)). The money can still go in; it just isn't deductible. This primer doesn't work through those limits.

**For the Reyes family:** Dana is 48 at the end of 2026, so the limit is $7,500, and Dana's $6,000 fits under it. Dana can use the catch-up from 2028, the year Dana turns 50.

### Can you take money out of a Traditional IRA early?

**Short answer:** yes, but money taken out of a Traditional IRA or 401(k) before age 59½ usually costs an extra 10% tax on top of income tax.

"Generally, if you are under age 59½, you must pay a 10% additional tax on the distribution of any assets (money or other property) from your traditional IRA" ([IRS Publication 590-B](https://www.irs.gov/publications/p590b)). The rule itself is in the tax law at [26 U.S.C. 72(t)](https://www.law.cornell.edu/uscode/text/26/72). There are exceptions, such as disability or up to $10,000 for a first home, listed on the [IRS exceptions page](https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-exceptions-to-tax-on-early-distributions).

**Example:** before turning 59½, Dana takes $1,000 out of the Traditional IRA. Dana pays income tax on it as usual (at 20%, $200), plus the extra 10% ($100). Dana keeps $700.

**For the Reyes family:** Dana turns 59½ on 14 November 2037, and Jordan on 2 March 2040.

### Can you take money out of a Roth IRA early?

**Short answer:** the money you put in, yes, any time and without tax. Only the growth has rules.

The money Dana _put in_ to a Roth IRA was already taxed, so taking it back out is never taxed: "Distributions that are a return of contributions aren't subject to tax" ([IRS Topic 451](https://www.irs.gov/taxtopics/tc451)). The _growth_ comes out tax-free once the withdrawal is _qualified_. That needs two things ([IRS Publication 590-B](https://www.irs.gov/publications/p590b), "What Are Qualified Distributions?"):

- **Five tax years have passed**, counting from the first year for which anything was put into a Roth IRA.
- **And** the owner is 59½ or older, or the withdrawal is because of disability or death, or up to $10,000 for a first home.

### When must you take money out?

**Short answer:** from a Traditional IRA or 401(k), every year from age 73 or 75, depending on your birth year. From a Roth IRA, never while you're alive.

The government let this money grow without tax for decades. Eventually it wants its tax, so it requires a minimum amount to come out every year. That amount is a **Required minimum distribution**, or **RMD**.

The age you start depends on when you were born ([26 U.S.C. 401(a)(9)(C)(v)](https://www.law.cornell.edu/uscode/text/26/401); [26 CFR 1.401(a)(9)-2](https://www.law.cornell.edu/cfr/text/26/1.401%28a%29%289%29-2)):

| Born              | RMDs start at |
| ----------------- | ------------- |
| 1951 through 1958 | 73            |
| 1960 or later     | 75            |

(The regulation leaves 1959 unspecified, marking it only "[Reserved]", and the IRS's own pages still mention only age 73. Neither Reyes was born in 1959.)

**For the Reyes family:** both were born after 1959, so both start at 75. Dana turns 75 in 2053, and Jordan in 2055.

Roth IRAs are different: "The minimum distribution rules that apply to traditional IRAs don't apply to Roth IRAs while the owner is alive" ([IRS Publication 590-B](https://www.irs.gov/publications/p590b)). A Roth IRA can keep growing untouched for life.

How each year's RMD amount is worked out (the balance divided by a number from an IRS life-expectancy table) comes in the planning phase.

### Can everyone use a Roth IRA?

**Short answer:** no. Above a certain income, the amount you can put into a Roth IRA shrinks, and then disappears.

The income measured is _modified adjusted gross income_, roughly the household's taxed income before most deductions. For 2026, the limit shrinks between $153,000 and $168,000 of it for a single person, and between $242,000 and $252,000 for a married couple filing taxes together ([IRS news release IR-2025-111](https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500)). Above the top of the range, nothing can go in directly.

**Example:** suppose the Reyes family earns $180,000 a year together. (The world file doesn't record income yet; this is an assumption for the example.) That's under $242,000, so either of them could put the full $7,500 into a Roth IRA this year.

The same income decides the rate on long-term gains (Part 2). For 2026, a married couple filing together pays 0% on long-term gains while taxable income is up to $98,900, 15% up to $613,700, and 20% above that ([Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf), section 4.03). At $180,000, the Reyes family would be in the 15% band.

## Part 5: Who owns what in the Reyes Household (Level 2)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../diagrams/reyes-accounts.dark.svg">
  <img alt="The Reyes Household: Dana, the Primary, born 1978, and Jordan, the Co-client, born 1980. At the Custodian, managed by the Firm: CW-000001, a taxable joint account, with Dana and Jordan both joint owners; and CW-000002, Dana's Traditional IRA, with Dana as owner and Jordan as Beneficiary, drawn dashed. Held away, known but not managed: Jordan's 401(k) at Jordan's employer, with Jordan as participant." src="../diagrams/reyes-accounts.light.svg">
</picture>

Each arrow is an Account role. The 401(k) isn't in the world file yet; it's added here as an example of a Held-away asset.

### Who owns the joint account, and what happens if one of them dies?

**Short answer:** Dana and Jordan both own it. With the right of survivorship, if one dies, the other simply owns everything.

There are two common forms of joint ownership, and the difference only shows when an owner dies ([FINRA, "Plan Now to Smooth the Transfer of Your Brokerage Account Assets on Death"](https://www.finra.org/investors/insights/plan-ahead-transfer-your-brokerage-account-assets-death)):

- **Joint tenants with right of survivorship.** "Each party has equal right to the account's assets. Each party also has the right of 'survivorship'—when one co-owner dies, all the assets in the account can pass to the other co-owner(s) without going through probate." Probate is the court process that sorts out a dead person's property; skipping it is quicker and cheaper.
- **Tenants in common.** Each owner has their own share, which they can leave to someone else. The other owner doesn't inherit it automatically.

"Tenant" here means owner; the words come from old property law. State law governs the details.

A single owner can get something similar without a second owner: a **transfer on death** registration, which "allows you to pass the securities you own directly to another person or entity upon your death without having to go through probate" ([Investor.gov, "Transferring Assets"](https://www.investor.gov/additional-resources/information/seniors/transferring-assets)).

### Why is Jordan only a Beneficiary of Dana's IRA?

**Short answer:** because an IRA can only ever have one owner. The most Jordan can be is the person who inherits it.

"IRAs can't be owned jointly. However, any amounts remaining in your IRA upon your death will be paid to your beneficiary or beneficiaries" ([IRS Topic 451](https://www.irs.gov/taxtopics/tc451)). So even married couples each have their own IRAs. If Jordan wants one, Jordan opens a separate one.

### Where does Jordan's 401(k) fit?

**Short answer:** it's part of the Reyes family's wealth, but not an Account the Firm manages, so Cognitive Wealth knows about it without holding it.

Jordan's 401(k) sits with Jordan's employer's plan, not at the Firm's Custodian. The Advisor can't buy or sell in it. But it still matters for advice: it's part of how much the Reyes family will have in retirement, and part of their Net worth.

So Cognitive Wealth records it as a **Held-away asset**, next to things like a house or a car, rather than as an Account with a Ledger.

## Part 6: In the real world (Level 3)

### Can money move from one Account type to another?

**Short answer:** often, yes, through a **Rollover**: moving retirement money from one plan or IRA to another without paying tax on the move.

A typical case: someone leaves a job and moves their old 401(k) into an IRA at the Firm's Custodian. Now the Advisor can manage it, and it becomes an Account with a Ledger.

"Most pre-retirement payments you receive from a retirement plan or IRA can be 'rolled over' by depositing the payment in another retirement plan or IRA within 60 days. You can also have your financial institution or plan directly transfer the payment to another plan or IRA" ([IRS, "Rollovers of retirement plan and IRA distributions"](https://www.irs.gov/retirement-plans/plan-participant-employee/rollovers-of-retirement-plan-and-ira-distributions)). The direct transfer is the safer way: miss the 60 days, and the money counts as taken out, with tax and maybe the 10% penalty. The IRS keeps a [rollover chart](https://www.irs.gov/pub/irs-tege/rollover_chart.pdf) of which moves are allowed.

For an advisor, a Rollover is good news: money that was held away becomes money the Firm manages. Bringing assets in is phase 6's Onboarding.

### What is a Roth conversion?

**Short answer:** moving money from a Traditional IRA to a Roth IRA on purpose, and paying the income tax on it now, so it's tax-free later.

Part 3 said a Traditional IRA wins when your tax rate is lower later, and a Roth wins when it's higher. A conversion lets you change your mind after the fact.

**Example:** suppose that, years from now, Dana's Traditional IRA has grown well past its first $6,000, and Dana converts $10,000 of it to a new Roth IRA. The $10,000 counts as income this year, so at 20%, Dana pays **$2,000** of tax now. From then on, that money and all its growth come out tax-free.

When is that worth it? In a year when Dana's tax rate is unusually low, such as a year between stopping work and starting to receive Social Security, the government pension most retirees get. Paying 20% now beats paying 30% later. Advisors look for those years on purpose, and Cognitive Wealth's planning phase (phase 5) has a Roth conversion Scenario to test them.

A conversion has its own five-year rule: for an owner under 59½, converted money taken out of the Roth IRA within five years can trigger the 10% penalty ([IRS Publication 590-B](https://www.irs.gov/publications/p590b)).

### Which year does a contribution count for?

**Short answer:** an IRA contribution can count for the year before, if it's made before that year's tax return is due, around mid-April.

"Contributions can be made to your traditional IRA for a year at any time during the year or by the due date for filing your return for that year, not including extensions. For most people, this means that contributions for 2025 must be made by April 15, 2026" ([IRS Publication 590-A](https://www.irs.gov/publications/p590a)).

So Dana's $6,000 on 2 March 2026 could count toward **2025 or 2026**. Dana chooses, and tells the Custodian. The date the Contribution happens (its Trade date) and the tax year it counts for are two different things, and the Custodian has to record both. Cognitive Wealth's world doesn't model this yet: the simplification is that every contribution counts for the year it's made.

### Can a spouse without a job have an IRA?

**Short answer:** yes, if the couple files taxes together: the working spouse's pay counts for both.

An IRA needs earnings from work (Part 4), but for a married couple filing together, "only one of you needs to have compensation" ([IRS Publication 590-A](https://www.irs.gov/publications/p590a)). The IRS calls this the Kay Bailey Hutchison Spousal IRA. It's still a separate IRA, owned by one person: "You can't both participate in the same IRA."

### What happens to a Custodial account when the child grows up?

**Short answer:** at the age the state sets, the child takes control and can spend it on anything. Until then, large earnings may be taxed at the parents' rate.

These accounts "have no withdrawal penalties, contribution limits or use restrictions beyond that the funds must be used solely for the benefit of the minor" ([FINRA, "Investing for Children"](https://www.finra.org/investors/insights/investing-children)). But there are two catches:

- **Control passes completely.** Once the custodianship ends, the money is the young adult's, to spend on university or a sports car. Parents who want control for longer use a trust instead, which this project doesn't model.
- **The kiddie tax.** To stop parents moving investments into a child's name just to pay a lower tax rate, "If your child's interest, dividends, and other unearned income total more than $2,700, it may be subject to a specific tax on the unearned income of certain children" ([IRS Topic 553](https://www.irs.gov/taxtopics/tc553)). Above that amount, the child's investment income can be taxed at the parent's rate. For 2026 the threshold is twice the $1,350 in [Rev. Proc. 2025-32](https://www.irs.gov/pub/irs-drop/rp-25-32.pdf), section 4.02: $2,700.

### What if 529 money isn't spent on education?

**Short answer:** the growth part is taxed as income, plus an extra 10%. Since 2024, some leftover money can move to a Roth IRA instead.

The money that went in was already taxed, so only the growth is affected. "Generally, if you receive a taxable distribution, you must also pay a 10% additional tax on the amount included in income" ([IRS Publication 970](https://www.irs.gov/publications/p970)).

**Example:** $10,000 went into a 529 plan and grew to $15,000, but the student gets a full scholarship. Taking all $15,000 out for something else: the $10,000 put in comes back untaxed; the $5,000 of growth is taxed as income, plus 10% of it, $500. (There are exceptions, including a scholarship; this example ignores them to show the basic rule.)

Leftover money can instead move to a Roth IRA for the student, within limits: up to a $35,000 lifetime total, only from a 529 plan open for at least 15 years, and within the yearly Roth IRA limit ([IRS Topic 313](https://www.irs.gov/taxtopics/tc313)).

## Part 7: What this means for the code (Level 3)

### Where do Account types show up in Cognitive Wealth?

**Short answer:** in three places: each Account's Registration type, the Account roles that link People to Accounts, and the line between Accounts the Firm manages and Held-away assets.

- **Registration type.** The custodian's `Account` table stores one of: `individual`, `joint`, `traditional_ira`, `roth_ira`, `custodial` and `529` (`RegistrationType` in `apps/custodian/src/custodian/models.py`). The world file (#35) gives each Account one.
- **Account roles.** The world file (#35) links each Person to Accounts with a role and a start date: `owner`, `joint_owner`, `custodian`, `beneficiary` or `power_of_attorney` (someone allowed to act for the owner, such as a grown child for an elderly parent). Cognitive Wealth's seed loads them (#39). Nothing checks this primer's ownership rules yet; #39 is the natural place to add checks such as "an IRA has exactly one owner" and "a joint account has two".
- **Managed or held away.** Accounts at the Custodian have a Ledger, Positions and Market value, and count toward the Firm's **AUM**. A 401(k) at an employer is a Held-away asset: part of the Household's Net worth, but not of AUM.

### Which later features care about the Registration type?

**Short answer:** almost everything that moves money or plans for the future.

| Feature                         | Phase | Why it needs the Registration type                                                                                                                                               |
| ------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The world generator             | 1     | Realistic Households have realistic mixes: a retiree has IRAs, a young family has a joint account and maybe a 529                                                                |
| Advisory fees                   | 3     | A fee is paid by taking money out of an Account. Taking money out of an IRA has tax rules a Taxable account doesn't, so which Account pays matters. The billing primer covers it |
| RMD tracking                    | 5     | RMDs apply to Traditional IRAs and 401(k)s, from an age set by the owner's birth year                                                                                            |
| Roth conversion Scenario        | 5     | Needs to know which Accounts are Traditional, which are Roth, and the tax rate each year                                                                                         |
| Bringing assets in (Onboarding) | 6     | A Rollover from a held-away 401(k) creates a new IRA at the Custodian                                                                                                            |

A rule to remember for the code: **the Registration type decides the tax rules, and the Account roles decide the people.** Neither is a free-text label. Both are fixed lists, so code can check them.

## Recap

1. Every Account has a **Registration type**: its legal kind, which sets who can own it and how it's taxed.
2. A Household has several Accounts because each type is a different tax deal, and families want several deals at once.
3. Investment money can be taxed on the way in, while it grows, or on the way out. That gives three **tax buckets**: taxable, tax-deferred and tax-free.
4. A **Taxable account** (individual or joint) has no limits and no penalties, but its dividends, interest and gains are taxed. Gains on investments held more than a year are taxed less.
5. A **Traditional IRA** takes money before tax and taxes it on the way out. A **Roth IRA** takes money after tax and never taxes it again, growth included.
6. With the same tax rate going in and coming out, Traditional and Roth come out equal. A lower rate later favours Traditional; a higher rate later favours Roth.
7. A **401(k)** is an employer's retirement plan with higher limits. For Cognitive Wealth it's usually a **Held-away asset**.
8. A **Custodial account** belongs to a child, managed by an adult until an age set by the state. A **529 plan** grows tax-free for education.
9. The tax break comes with rules: yearly limits ($7,500 for IRAs in 2026), earnings from work, a 10% penalty before 59½, and **RMDs** from 73 or 75. Roth IRAs have no RMDs for their owner.
10. An IRA has exactly one owner. A spouse can be its **Beneficiary**. A joint account has two owners, and with right of survivorship, the survivor owns it all.
11. A **Rollover** moves retirement money between plans without tax. A **Roth conversion** moves Traditional money to Roth and pays the tax now.
12. In the code, the Registration type sets the tax rules, and the Account roles set the people. Managed Accounts count toward AUM; held-away ones count toward Net worth only.

## Check yourself

Try to answer each one before opening it.

<details>
<summary>1. Dana puts $1,000 of salary into a Roth IRA. The tax rate is 20% and the investments double. How much does Dana keep in retirement?</summary>

$1,600. The 20% tax is paid on the way in, so $800 is invested. It doubles to $1,600, and qualified Roth withdrawals aren't taxed.

</details>

<details>
<summary>2. Same $1,000, but in a Traditional IRA, and Dana's tax rate in retirement is 10%. How much does Dana keep, and which choice was better?</summary>

$1,800. All $1,000 is invested, doubles to $2,000, and 10% tax on the way out leaves $1,800. The Traditional IRA was better than the Roth's $1,600, because Dana's tax rate was lower later than now.

</details>

<details>
<summary>3. Why can't Dana and Jordan open one IRA together, like their joint account?</summary>

Because an IRA always has exactly one owner: "IRAs can't be owned jointly." Each of them can have their own, and each can name the other as Beneficiary.

</details>

<details>
<summary>4. Dana is 48 in 2026. How much can Dana put into IRAs this year, and when does the catch-up start?</summary>

$7,500 for 2026. The extra $1,100 catch-up starts in 2028, the year Dana turns 50.

</details>

<details>
<summary>5. At 45, Jordan takes $1,000 out of a Traditional IRA. The tax rate is 20%. How much does Jordan keep?</summary>

$700. Income tax of $200, plus the extra 10% for taking it out before 59½, $100. (Unless an exception applies.)

</details>

<details>
<summary>6. When do Dana's RMDs start, and would they start if the IRA were a Roth IRA?</summary>

In 2053, the year Dana turns 75, because Dana was born after 1959. A Roth IRA has no RMDs while its owner is alive.

</details>

<details>
<summary>7. Jordan has a 401(k) at work. Does it count toward the Firm's AUM?</summary>

No. It's held at the employer's plan, not at the Firm's Custodian, and the Advisor doesn't manage it. It's a Held-away asset: part of the Reyes family's Net worth, not of AUM. If Jordan rolled it over into an IRA at the Custodian, it would become a managed Account and count toward AUM.

</details>

<details>
<summary>8. (Level 3) Dana converts $10,000 from the Traditional IRA to a Roth IRA, in a year when Dana's tax rate is 20%. What does it cost, and why might it be worth it?</summary>

$2,000 of tax now, because the $10,000 counts as income this year. It's worth it if Dana's tax rate in retirement would have been higher than 20%: the money and its growth then come out tax-free instead.

</details>
