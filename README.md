# Social OS 🫶

A private friendship app built on your own Google Sheet. Your contacts stay in your Google account. The app is just a nicer window onto the sheet.

```
apps-script/Code.gs      ← server side (reads and writes your sheet, sends emails)
apps-script/Index.html   ← the app itself
launcher/                ← optional: gives you a proper home-screen icon
```

## Updating your existing app

1. **Back up first:** in the sheet, choose **File → Make a copy**.
2. Open **Extensions → Apps Script**.
3. Replace everything in `Code.gs` with `apps-script/Code.gs`.
4. Replace everything in `Index.html` with `apps-script/Index.html`.
5. **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy.** Your link stays the same.
   - Set **Execute as: Me** and **Who has access: Only myself**.
6. Open the app. Google will ask for new permissions: sending email to you (Christmas and birthday lists), looking up places for the map, reading your calendar (only used if you switch it on), and scheduling the daily reminder. Approve them.
7. In the app, go to **Dates → Christmas** and switch on **Email me this list on 25 November**.

### What changes in your sheet

- **Nothing is deleted or renamed.** Formula columns (Friend Health Score, Contact Task and so on) are left alone and shown as 🔒 in the app.
- The first time you use them, the app adds these columns to the end of **Main**: `Last Called`, `Last Invited`, `Next Plan`, `Next Plan Date`, `Phone`, `Likes`, `Dislikes`, `Notes`.
- An `Email` column is added if you fill one in. It's used to match calendar guests.
- Your home bases and app settings are saved in the script's settings, not the sheet.
- Two more hidden sheets: `_Log` (every catch-up, invite and plan outcome you log, which powers reliability, XP and streaks) and `_Weekly` (one friendship score per week).
- The map adds a hidden sheet called `_Geo` that remembers where each place is, so it only looks each one up once.
- You have **two "Address" columns**. The app treats the second as "Address (2nd column)". For Christmas labels it uses whichever one has a house number or postcode in it. If you rename one (for example to "Postal Address"), the app will cope.

## How health is worked out: the friendship battery

Every catch-up tops up a friend's battery, and it slowly drains. Seeing someone often counts for more than seeing them once, and different kinds of contact count differently:

| Catch-up | Adds | On its own, can fill the battery to |
|---|---|---|
| 🤝 In person | 100 | 100% |
| 🎥 Video | 60 | 75% (90% for friends abroad or 5+ hours away) |
| 📞 Call | 45 | 60% (70% if far away) |
| 💬 Message / 📥 they got in touch | 25 | 40% |

- **Draining:** in-person points halve over the friend's "see" aim (distance band's Invite Goal × tier's See Multiplier). Messages halve over the tier's Contact Goal Days, and calls and video somewhere in between.
- **Together:** calls, video and messages top up whatever in-person time hasn't filled. A video call keeps a friendship warm but doesn't replace seeing someone. Example: a tier-1 friend not seen in person for 80 days sits at about 40%; a video call yesterday takes them to about 85%, which drains back below 70% within a couple of weeks unless you see them.
- **Plans:** a plan in the diary keeps the battery at 70% or above, whoever organised it.
- **To-do lists:** **💬 Message** is everyone past their contact goal. **🤝 To see** is everyone past their see goal whose battery is under 70% and who has no plan. Both lists are sorted by how much each person needs you, with closer tiers and more reliable friends first.
- **History:** before you install this, the app only knows each friend's last dates from the sheet, so batteries are rough to start with and get more accurate as you log.
- **Tuning:** the numbers are in `BATTERY` near the top of the script in `Index.html`. Proximity 6 has no Invite Goal in your Settings sheet, so the app uses 10 days; add a number there to change it.
- **Your old split:** your 60/40 formula judged each friend on two "how long since" clocks, so it couldn't count frequency or give video partial credit, and everyone overdue sat at 0. The battery fixes all three.

## Logging, the easy way

- **⚡ Log catch-ups** (the button on Today, and the floating button) lets you type it like a text, for example *"dinner with Sam and Jo on Saturday, called Mum yesterday, video with Chen, Alex texted me"*. It picks out the people, what you did and when. Tap a chip to fix the type, the day, or which Sam you meant, then log them all at once. Below that, tap 💬 📞 🎥 🤝 next to anyone for a one-tap log on any of the last 7 days.
- **📆 Google Calendar** (switch it on from Today or Settings): events from the last 2 weeks that mention a friend's name (or have their address from the `Email` column as a guest) become suggested catch-ups. Online meetings become 🎥 video. Upcoming events become plans. You confirm each one, or tap ✕ and it won't be suggested again.
- **🤖 Plans log themselves:** 2 days after a plan's date, it's logged as a catch-up. Today shows a list of these so you can tap *They ✗* or *Me ✗* if it didn't happen, which puts the old dates back.
- **Plans aren't "bookings":** 📅 Plan is for anything in the diary, whoever arranged it. You can say who organised it; if *they* did, it counts in their favour for reliability. 💌 *I invited them* is separate, for when you did the inviting.
- **Older catch-ups:** logging one from the past goes into the history and counts towards the battery, without moving the sheet's "last" dates backwards.

## Home bases (for when you're living in more than one place)

Tap **🏠 Living in…** on Today or Places, add each place you live (a name plus a postcode), then tap whichever you're living in now. With **Work out distances automatically** switched on, each friend's distance band is worked out from your current base and their address, or their first place tag if there's no address:

| Band | Distance from your base |
|---|---|
| 6 · walking distance | under 1.5 km |
| 5 · 30 min public transport | 1.5–8 km |
| 4 · same city (rename "London-based" to "Same city" in your Settings sheet so it reads right wherever you live) | 8–30 km (a place tag on its own never counts as closer than this, because it's only city-precise) |
| 3 · within the UK | 30–400 km |
| 2 · 5+ hours away | over 400 km |
| 1 · another country | different country, or over 700 km |

Friends with no address or place tag keep the Proximity Score from your sheet. Switch your base and every "seen" goal, list and health score updates.

## Places and invites

- **📍 Places tab:** one section per home base (friends within 30 km) and per place tag, most overdue first.
- **💌 Invite planner** (from Today, a place, or a friend's page): choose where, what (coffee, dinner…), how many, and optionally a tag. You get the most overdue friends, closest tiers first, with allergies, likes and dislikes shown. **Mark invited** logs it for everyone at once, and they're left off the to-book lists for 14 days.
- **Monday email** (with reminders on): upcoming birthdays plus the top 5 people to invite near your current base.

## Reliability & tier check-ins

Answer the app's quick prompts and it learns who shows up:
- **"Did this happen?"** after a plan: *Yes* / *They cancelled* / *I cancelled* (you cancelling never counts against them).
- **"Any replies?"** 4+ days after an invite: *Booked* / *Said no* / *No reply*.
- **📥 They got in touch**, on a friend's page, when they message you first.

Reliability = (kept + said yes + 1) ÷ (kept + said yes + cancelled + no reply + ½ × said no + 2). It appears after 3 outcomes. Friends below 40% get nudged a little less, so your effort goes where it's returned.

**🎚️ Tier check-in** suggests moving someone **down** a tier if they're under 40% reliable, or if you've messaged or invited them 5+ times in 90 days with no reply, call or meet-up. (That second rule only switches on once you've used 📥 a few times.) It suggests moving someone **up** if they're 80%+ reliable and often get in touch first. Nothing changes until you tap *Move*. *Keep* hides the suggestion for 90 days.

## The game

- **Friendship score:** everyone's health averaged, with closer tiers counting more. It's saved weekly so you can see if you're improving. The chart starts the week you install this; there's no history before then.
- **XP:** message 5, call 10, see someone 25, invite 5, book 10, plan happened +15, reconnect after 6+ months +20, birthday +10. You get 3 **weekly quests** (+30 each), a 🔥 **streak** for every week you earn 40+ XP, 10 **levels** from Hermit crab 🐚 to Mayor of friendship 👑, and 12 **badges**.
- The Monday email includes your score and how it changed from the week before.

## Home-screen icon (optional)

A Google Apps Script link can't have its own icon, so `launcher/` is a tiny page that holds the icon and opens your app. It contains no personal data, and your app link only goes in the bookmark.

1. Host the `launcher` folder for free. Either:
   - **Cloudflare Pages:** Workers & Pages → Create → Pages → *Upload assets* → drag in the `launcher` folder; or
   - **GitHub Pages:** put it in a public repo → Settings → Pages.
2. Open that page on your phone and paste your `/exec` link.
3. **iPhone:** Share → Add to Home Screen. **Android:** ⋮ → Add to Home screen.

The first time you open it from the home screen, you may need to sign in to Google once.

## Sharing with friends: a template

Each friend gets their own private copy, and nobody can see anyone else's list.

**Set up the template once:**
1. Create a new blank Google Sheet called "Social OS template". Do **not** use your real sheet.
2. **Extensions → Apps Script**: paste in `Code.gs`, add an HTML file called `Index` and paste in `Index.html`. Save.
3. **Share → Anyone with the link → Viewer.**
4. Take the sheet's link, change the ending `/edit…` to `/copy`, and send that to friends.

**Each friend then:**
1. Opens the `/copy` link and taps **Make a copy**. That copies the script too.
2. In their copy: **Extensions → Apps Script → Deploy → New deployment → Web app** (Execute as: Me, Who has access: Only myself).
3. Opens their link and approves the permissions. On first run the app creates `Main` and `Rules` with starter goals.
4. Optional: uses your launcher page with **their own** link to get the icon.

When you improve the code later, friends need to paste in the new files themselves. Copies don't update automatically.

## Privacy

- Allergies, likes and dislikes are in their own **Food & preferences** section and aren't included in the Christmas list or email.
- With **"Only myself"** access, only you (signed in to Google) can open the app. Anyone else who gets the link sees a Google error page.
- The app keeps a copy of your list in your phone's browser storage so it opens instantly. **Settings → Clear saved data** removes it.
- Map lookups go through Google's geocoder from your own script. Map images come from OpenStreetMap, which only sees which map area is being viewed.
