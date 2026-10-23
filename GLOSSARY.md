# Cognitive Wealth

Cognitive Wealth is software for independent financial advisors: it holds the advisor–client relationship, the household's money as the custodian reports it, and the planning work done on top of it, with Cognitive AI working alongside the advisor.

## Product

**Cognitive Wealth**:
The product: the software a Firm uses to serve its Households.

**Cognitive AI**:
The AI layer of Cognitive Wealth. It explains, drafts and orchestrates; it states only Computed facts.
_Avoid_: Assistant, copilot, bot

**Computed fact**:
A number produced by a deterministic calculation from recorded data, kept with the inputs it was computed from. The only kind of number Cognitive AI may show.
_Avoid_: Estimate, AI figure

**Agent**:
A specialist part of Cognitive AI with its own tools and focus: Planning, Tax, Investment or Relationship.
_Avoid_: Bot, assistant

**Planning session**:
A titled, saved piece of work about one Household, done by an Advisor together with Cognitive AI. It holds the conversation and the Scenarios, Recommendations and Summary that came out of it.
_Avoid_: Session (alone), canvas, chat

**Scenario**:
A set of assumptions run through a calculation and compared with a baseline, such as converting $24K to a Roth IRA this year against not converting.
_Avoid_: Simulation, what-if

**Recommendation**:
A proposed action for a Household, with its rationale, impact, caveats and when to revisit it. Drafted by Cognitive AI or an Advisor, and never shown to a Household until an Advisor approves it.
_Avoid_: Suggestion, advice

**Summary**:
The client-ready Document produced from a Planning session.
_Avoid_: Report

**Insight**:
Something noticed about a Household that deserves an Advisor's attention, such as an Account with no beneficiary or a new eligibility for Roth contributions.
_Avoid_: Alert, notification, signal

## Firm and people

**Firm**:
An independent wealth-management business, registered as an investment adviser, that uses Cognitive Wealth. Each Firm's data is isolated from every other Firm's. A solo independent advisor is a Firm with one Advisor.
_Avoid_: Organization, workspace, tenant, company

**Advisor**:
A person at a Firm who gives investment advice to Households and is responsible for them.
_Avoid_: Planner, rep, agent, broker

**User**:
Someone who signs in to Cognitive Wealth. Always a member of a Firm's staff; Households never sign in.
_Avoid_: Account, login

## Households

**Household**:
The group of people a Firm serves together, and the unit of service, billing and planning.
_Avoid_: Client (as an entity), family, relationship

**Person**:
An individual the Firm knows about, usually as a member of a Household.
_Avoid_: Contact, client

**Primary**:
The Person who leads a Household's relationship with the Firm.

**Co-client**:
A Person who shares the Household's relationship with the Primary on equal footing, usually a spouse or partner.

**Dependent**:
A Person in a Household who is supported by its Primary or Co-client, usually a child, and is not party to the advisory relationship.

**Relationship status**:
Where a Household stands with the Firm: Prospect, Client or Former client.

**Prospect**:
A Household the Firm is trying to win, before an Advisory agreement is signed.
_Avoid_: Lead

**Client**:
A Household with a signed Advisory agreement. A status of a Household, not a separate thing.

**Former client**:
A Household whose Advisory agreement has ended.

## Accounts and custody

**Custodian**:
The regulated institution that holds a Household's assets and is the book of record for their holdings and transactions.
_Avoid_: Broker, bank, clearing firm

**Book of record**:
The source that is right when two systems disagree. For holdings and transactions it is the Custodian; for fees, plans and the relationship it is Cognitive Wealth.
_Avoid_: Source of truth (when the owner matters)

**Account**:
A custodial account at a Custodian, identified by the Custodian's account number. Linked to People through Account roles, not owned by a Household.
_Avoid_: Portfolio, login

**Account role**:
A dated link between a Person and an Account that says how the Person is involved: owner, joint owner, custodian for a minor, beneficiary, or power of attorney.

**Registration type**:
The legal form of an Account, which sets its ownership and tax rules: individual, joint, traditional IRA, Roth IRA, custodial account for a minor, 529, and so on.

## Holdings

**Security**:
Something an Account can hold: a fund, a stock, a bond, or the cash sweep.
_Avoid_: Instrument, asset, holding

**Transaction**:
A dated movement the Custodian records in an Account: a buy, sell, dividend, interest payment, contribution, withdrawal, fee or transfer.
_Avoid_: Activity, trade (a trade is only a buy or a sell)

**Trade date**:
The day a Transaction happened.

**Ledger**:
The Custodian's append-only list of an Account's Transactions. Rows are added, never changed or deleted.
_Avoid_: Journal, history

**Settlement date**:
The day a Transaction became final, when cash and Securities actually changed hands.

**Settlement cycle**:
The number of Business days from Trade date to Settlement date. For most US securities trades it is one, written T+1.

**Posting date**:
The day the Custodian wrote a Transaction to the Ledger. The same as the Trade date, except for a Correction, which is posted when the mistake is found.
_Avoid_: Booking date, process date

**Correction**:
The fix for a wrong Transaction: a Reversal of it plus a new, right Transaction, both on the original Trade date.
_Avoid_: Edit, amendment, cancel/rebill

**Reversal**:
A Transaction that exactly undoes an earlier one, with every amount negated, and points back at it.
_Avoid_: Cancel, void

**Settled cash**:
The cash in an Account whose Transactions have reached their Settlement date: what can actually be withdrawn.
_Avoid_: Available cash, buying power

**Position**:
The shares of one Security held in one Account on a given date, rebuilt from the Account's Transactions.
_Avoid_: Holding

**Tax lot**:
Shares of a Security bought together, with their own purchase date and Cost basis.
_Avoid_: Lot (alone)

**Cost basis**:
What was paid for a Tax lot, used to work out the gain or loss when it is sold.
_Avoid_: Book value

**Market value**:
The shares of a Position multiplied by the Security's price on a given date.
_Avoid_: Balance (for a Position)

**Cash sweep**:
Where the Custodian keeps an Account's uninvested cash overnight, such as a bank deposit or a money market fund, earning interest. Treated as a Security priced at exactly $1.00, so cash is a Position like any other.
_Avoid_: Cash balance, money market (when the sweep is meant)

**Business day**:
A weekday on which US markets are open.
_Avoid_: Trading day, working day

**Close**:
The end of a business day at the Custodian, which produces that day's prices, Transactions and Positions.
_Avoid_: End of day, batch

**As-of date**:
The business day a figure describes, which is the latest Close it was computed from.

**Custodian feed**:
The files the Custodian publishes for each Close.
_Avoid_: Export, dump

**Reconciliation**:
Comparing the Positions Cognitive Wealth rebuilt from Transactions with the Positions the Custodian reports.

**Break**:
A difference Reconciliation found, kept until someone resolves it.
_Avoid_: Mismatch, discrepancy

## Wealth and fees

**AUM**:
Assets under management: the market value of the Accounts a Firm manages, on a given date.
_Avoid_: Assets (unqualified), portfolio value, book size

**Billable value**:
The part of a Household's AUM that fees are charged on, after exclusions such as an unmanaged legacy position.
_Avoid_: Billable assets, fee base

**Held-away asset**:
Something of value a Household owns outside the Accounts the Firm manages: an employer 401(k), a home, a car, a life insurance policy.
_Avoid_: Outside account, non-portfolio asset

**Liability**:
Money a Household owes: a mortgage, a car loan, a credit line.
_Avoid_: Debt

**Net worth**:
Everything a Household owns, in Accounts and held away, minus its Liabilities.

**Advisory agreement**:
The signed contract between a Firm and a Household that makes the Household a Client and sets its Fee schedule.
_Avoid_: Contract, IMA

**Fee schedule**:
The rates a Household pays on its Billable value, as tiers between Breakpoints, such as 1.00% on the first $1M and 0.75% on the next $4M.
_Avoid_: Pricing, fee table

**Breakpoint**:
A Billable value at which the Fee schedule's rate changes. Breakpoints apply to the whole Household's Billable value, not to each Account.

**Billing period**:
The span of days one Advisory fee covers, normally a calendar quarter.

**Advisory fee**:
What a Household pays the Firm for one Billing period, computed from its Fee schedule and collected from its Accounts through the Custodian.
_Avoid_: Management fee, charge

**RMD**:
Required minimum distribution: the amount the IRS requires an owner to withdraw each year from a tax-deferred Account, such as a traditional IRA, once they reach a set age.

**Annualized fee**:
A Household's Advisory fee for a year, projected from its current Billable value and Fee schedule.
_Avoid_: ARR, revenue, run rate

## Relationship work

**Interaction**:
Any contact with a Household that is logged: a Meeting, a call or an email. The latest one is the Household's last contact.
_Avoid_: Activity, touchpoint, event

**Meeting**:
A scheduled conversation with a Household, which may have a transcript and produces Notes and Tasks.

**Note**:
Free text about a Household, written by a User or drafted by Cognitive AI.

**Task**:
A piece of work with an owner and a due date, usually about a Household.
_Avoid_: To-do, action item

**Service item**:
A recurring obligation to a Household, such as the annual review, the RMD check or the beneficiary review.
_Avoid_: Service, reminder

**Service calendar**:
The Service items due for a Household, or across all Households.

**Document**:
A file about a Household: a statement, a tax return, a signed agreement, a summary.
_Avoid_: Attachment, file

## Growth

**Opportunity**:
A specific piece of potential new money for a Household, with an expected amount and a stage, such as rolling over a 401(k) from a former employer.
_Avoid_: Deal, lead

**Onboarding**:
The staged work of turning a Prospect who said yes into a funded, invested Client, in seven stages: Intake, Agreement, Compliance, Account opening, Asset transfer, Investing, Active. Each stage has its checklist of Tasks and Documents.
_Avoid_: Setup, activation

**Transition**:
An Advisor moving their Households from a previous firm to a new one, including re-papering their Accounts at a new Custodian.
_Avoid_: Migration, onboarding
