# MoneyLab

A personal household-budget, budgeting and asset app that takes BankSalad (뱅크샐러드) Excel exports and organizes them. Same structure as RunLab (FastAPI + SQLite + React PWA, phone access over Tailscale).

## Running

Double-click `start-moneylab.bat` (or the MoneyLab icon on the Desktop / in the Start menu) → the app window opens (http://localhost:8001).

A windowless background service (`moneylab-service.pyw`) starts the server, restarts it if it dies, rebuilds the web app when `frontend/` code changes, and restarts the server when `backend/app` code changes. A phone app that was left open switches to the new version when reopened. If you need a window that shows the server output, use `start-moneylab-console.bat`.

### Linux

- `./setup.sh` once (and again after pulling changes): `uv sync`, `npm ci`, web build. Needs [uv](https://docs.astral.sh/uv/) and Node.js 20+.
- `./install-autostart.sh` installs a systemd user service `moneylab.service`, which runs `moneylab-service.pyw` with
  `backend/.venv/bin/python` (the same supervisor as on Windows: keeps uvicorn alive, rebuilds the web app, restarts on
  backend edits), plus an app-menu launcher (`~/.local/share/applications/moneylab.desktop`), and opens the app window
  (a Chromium-family browser in `--app` mode, falling back to the default browser).
- `./start-moneylab.sh` / `./stop-moneylab.sh` / `./uninstall-autostart.sh` mirror the `.bat` files (uninstalling keeps
  the app-menu launcher; delete the `.desktop` file if you like).
- Status: `systemctl --user status moneylab`; logs: `data/logs/`.
- To keep it reachable from the phone while you are logged out: `loginctl enable-linger "$USER"`.
- On Linux, `tailscale serve` needs `sudo tailscale set --operator=$USER` once so it can run without sudo.

## Screens

| Screen | Contents |
|---|---|
| 홈 (Home) | This month's spending · living budget left · monthly chart · categories · travel/running/camera |
| 거래내역 (Transactions) | Filters by month, category and account. On the unfolded screen: list + detail editor side by side |
| 확인하기 (Review) | Uncategorized / possible duplicates / large transfers / real-time. Swipe right for "이대로 둘게요" (Leave as is), AI category suggestions |
| 예산 (Budget) | This month (limits, envelopes, savings, investments) / 12-month cash plan / subscriptions (calendar of upcoming payments) / per-card spending vs. payment / edit items |
| 여행·행사 (Trips & events) | Spending per trip, pre-departure bookings linked automatically, payments per currency with actual exchange rate and fees. **Conferences & events (학회·행사)** collect only your own spending; money paid on behalf of others goes to settlements |
| 취미 (Hobbies) | Running: monthly spending vs. km run (RunLab), cost per km, cost per km per shoe, race entry fees / camera purchases |
| 자산 (Assets) | Net-worth trend / investments / goals (including maturity estimates for savings plans such as 청년도약계좌, a government-backed youth savings account) / **Receivables (받을 돈)** (settlements with conferences and groups, money lent) / **Balance check (잔액 검증)** (find missing transactions with a bank-statement Excel file, match and correct against card statements) |
| AI 도우미 (AI assistant) | Ask your data / monthly report / read receipts and screenshots + manual entry (cash, foreign payments) |
| 가져오기 (Import) | BankSalad Excel, card-company and bank Excel files (pick the columns once; the format is remembered) |
| 설정 (Settings) | Categorization rules · accounts/card companies · payment-notification hook · AI · backup and autostart · phone |

Layout tuned for the Galaxy Z Fold: folded screen (< 600px) bottom tabs · unfolded screen (600–1279px) navigation rail + two panes · PC (≥ 1280px) sidebar.

## Budget model

- **Spending limits**: monthly limit per category group (living costs, fixed costs)
- **Sinking-fund envelopes**: build up every month and draw from them when spending in that category (a travel envelope includes spending during the trip)
- **Savings / investments**: money to move to savings and brokerage accounts every month
- Your own spending during a conference/event is collected separately under "학회·행사" (Conferences & events) (outside the budget unless there is a budget item with that name). Money paid on behalf of others is a settlement, not spending.
- Each expense goes into only one item, the first one from the top. The 12-month cash plan fills the month-end balance in the order emergency fund → envelopes → free money. Upcoming trips with a budget are added to the plan automatically.

## Phone (Android)

1. Settings → set a PIN for the phone
2. Run once on the PC (RunLab uses 443, so MoneyLab uses 8443):
   ```
   tailscale serve --bg --https=8443 8001
   ```
3. Open `https://<PC name>.ts.net:8443` in Chrome on the phone → ⋮ → Install app
4. **Share → MoneyLab** a BankSalad Excel file to import it right away

### Real-time payment notifications (optional)

When MacroDroid/Tasker POSTs `{"app", "title", "text"}` JSON to the address shown under Settings → Notifications & AI (알림·AI), it comes in as a real-time transaction. When the same payment arrives in the month-end Excel file, it is replaced automatically. This address is protected by its own token instead of the PIN.

### AI (optional)

Put `ANTHROPIC_API_KEY=…` in `backend/.env`, or run `ant auth login`, then restart. It can use the monthly API credit of a Max plan (link a Console organization under claude.ai → Settings → Billing → API credits).

- Category suggestions · questions · monthly report · receipt reading
- What is sent: merchant name, amount, date, category and totals. Transfer recipients that look like personal names are masked as "(개인)" (individual) before sending.
- Models: `MONEYLAB_AI_MODEL` (questions and reports, default `claude-opus-5-5`), `MONEYLAB_AI_FAST_MODEL` (categorization and receipts, default the same model). Example: `MONEYLAB_AI_FAST_MODEL=claude-haiku-5-5`

## Backup · autostart

- While the server is running, an **encrypted backup** is written once a day to `data/backups` (can be changed to OneDrive etc. in Settings); the latest 30 are kept
- Recovery key: `%USERPROFILE%\.moneylab\backup.key` → view it under Settings → Backup and keep it somewhere off the PC
- Restore: stop MoneyLab, then `cd backend && uv run python -m app.tools.restore <file>`
- Autostart at log-in + Start menu and Desktop icons: double-click `install-autostart.bat`, or Settings → Backup · autostart (백업 · 자동 실행) → PC app (PC 앱) (remove with `uninstall-autostart.bat`, stop with `stop-moneylab.bat`)
- Logs: `data/logs/` (service.log · server.log · build.log). Service control port 127.0.0.1:8091
- The RunLab integration opens `../runlab/data/runlab.db` read-only (change the path with `MONEYLAB_RUNLAB_DB`)

## Monthly routine

1. Export Excel from BankSalad (household ledger → gear icon → download as file; overlapping periods are fine)
2. Share it to MoneyLab or drag it onto the Import screen
3. Categorize the few items collected under Review, check the Budget tab

## Automatic clean-up rules

| Situation | Handling |
|---|---|
| Money from a bank to a card company (even if BankSalad misclassifies it as spending or investment) | Card payment → excluded from spending |
| Same amount on a simple-pay/debit card and a credit card within ±3 days | The card entry is marked as a duplicate |
| Deposits into installment savings / housing subscription accounts | Savings |
| Money sent to a brokerage / deposits and withdrawals in a brokerage account | Investment (counted once if it shows on both the bank and the brokerage side) |
| Transaction that came in first via a payment notification | Replaced when the same payment (same account and amount, ±4 days) arrives in the Excel file |
| Merchant keywords (Settings → Categorization rules) | Running / camera / travel / subscriptions etc. |
| Spending within a trip's dates, 'travel' payments within 1 year before departure | Linked to that trip automatically (conferences/events: only spending within the dates) |

Values edited by hand are kept on re-import (undo with "자동으로 되돌리기" (Revert to automatic) in the transaction detail).

## Records older than BankSalad

BankSalad only has records from the time an account was connected. For earlier periods, upload Excel files (.xlsx/.xls/.csv) downloaded from the card-company and bank websites on the Import screen; after you confirm the columns, only the part before BankSalad's first record date is filled in.

## Categories

Two levels, main > sub (e.g. 식비 > 외식 (Food > Eating out), 교통 > 항공 (Transport > Flights)). The list is TREE in `backend/app/engine/categories.py`. You can pick just a main category; filtering or budgeting by a main category includes all of its subcategories. Whether something is travel is not a category but a trip/event tag.

## Card statement matching

Upload Samsung (.xlsx) or Hyundai (.xls) card statements under Assets → Balance check → Card statement matching: each line is matched to a transaction, and the billed amount is compared with the amount debited from the bank account. "명세서 기준으로 맞추기" (Match to statement) adds payments and fees that exist only on the statement, plus the exchange-rate difference on foreign payments, as manual transactions, once.

## Data period

Setting a start date under Settings → Accounts & cards → Data period deletes transactions before it, and they are skipped on re-import.

## Old ledger CSV

A hand-kept ledger (Type, Date, Amount, Title, Category, Place, Account, …, Events, Note) is not imported as new transactions; instead it attaches notes, split payments (SettleIn/Out), refunds, income, events and subsidized payments to existing transactions.

```
cd backend
uv run python -m app.tools.legacy_import Transactions.csv                      # preview
uv run python -m app.tools.legacy_import Transactions.csv --apply --event "2026 Conference=2"
```

## Development

```
cd backend && uv run pytest
cd frontend && npm run dev   # :5174, /api → :8001
```

Data is stored only in `data/moneylab.db` (excluded by `.gitignore`).

## App window and taskbar

The app window opens at `http://moneylab.localhost:8001`: Edge names an app window's taskbar entry after its host (not the port), so each app has its own host and shows up as its own taskbar icon. The Start menu and Desktop shortcuts carry the same taskbar ID (`MSEdge.moneylab.localhost_/`), so pinning one to the taskbar works. `*.localhost` counts as this PC, like `localhost`.
