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
6. Open the app. Google will ask for new permissions: sending email to you (Christmas and birthday lists), looking up places for the map, and scheduling the daily reminder. Approve them.
7. In the app, go to **Dates → Christmas** and switch on **Email me this list on 25 November**.

### What changes in your sheet

- **Nothing is deleted or renamed.** Formula columns (Friend Health Score, Contact Task and so on) are left alone and shown as 🔒 in the app.
- The first time you use them, the app adds these columns to the end of **Main**: `Last Called`, `Last Invited`, `Next Plan`, `Next Plan Date`, `Phone`, `Likes`, `Dislikes`, `Notes`.
- Your home bases are saved in the script's settings, not the sheet.
- The map adds a hidden sheet called `_Geo` that remembers where each place is, so it only looks each one up once.
- You have **two "Address" columns**. The app treats the second as "Address (2nd column)". For Christmas labels it uses whichever one has a house number or postcode in it. If you rename one (for example to "Postal Address"), the app will cope.

## How health is worked out

**Health = 60% "in touch" + 40% "seen"**, the same split as your sheet's Friend Pulse formula. Each part scores 100 just after you log something, 70 when you reach the goal, and 0 at twice the goal. (Your formula hits 0 right at the goal, which puts every overdue friend at 0 so they can't be ranked against each other.) You can change the split in `WEIGHTS` near the top of the script in `Index.html`.

| | Goal comes from | Counts |
|---|---|---|
| 💬 In touch | Tier → *Contact Goal Days* | any message, call or meet-up |
| 🤝 Seen | Proximity → *Invite Goal* × Tier → *See Multiplier* | meet-ups. A call or video counts as **half a visit** (¾ for proximity 1–2, i.e. abroad or 5+ hours away) |

- **Default see multipliers:** Tier 1 ×0.5, 2 ×0.75, 3 ×1, 4 ×1.5, 5 ×2, 6 ×3. Add a `See Multiplier` column to your Rules sheet to change them.
  - Example: a Tier 1 friend living 30 minutes away gets 12 × 0.5 = about every 6 days. A Tier 4 friend abroad gets 365 × 1.5 = about every 18 months.
- A **booked plan** keeps "seen" at 85 or above until the date passes. Then the app asks whether it happened.
- **💬 Message** list: people past their contact goal. **📅 Book** list: people past their see goal with nothing booked. Both are sorted by how overdue they are, with closer tiers ranked higher.
- Proximity 6 ("15/20 minutes walk") had no Invite Goal in your Settings sheet, so the app uses 10 days. Add a number there to change it.

## Home bases (for when you're living in more than one place)

Tap **🏠 Living in…** on Today or Places, add each place you live (a name plus a postcode), then tap whichever you're living in now. With **Work out distances automatically** switched on, each friend's distance band is worked out from your current base and their address, or their first place tag if there's no address:

| Band | Distance from your base |
|---|---|
| 6 · walking distance | under 1.5 km |
| 5 · 30 min public transport | 1.5–8 km |
| 4 · same city | 8–30 km (a place tag on its own never counts as closer than this, because it's only city-precise) |
| 3 · within the UK | 30–400 km |
| 2 · 5+ hours away | over 400 km |
| 1 · another country | different country, or over 700 km |

Friends with no address or place tag keep the Proximity Score from your sheet. Switch your base and every "seen" goal, list and health score updates.

## Places and invites

- **📍 Places tab:** one section per home base (friends within 30 km) and per place tag, most overdue first.
- **💌 Invite planner** (from Today, a place, or a friend's page): choose where, what (coffee, dinner…), how many, and optionally a tag. You get the most overdue friends, closest tiers first, with allergies, likes and dislikes shown. **Mark invited** logs it for everyone at once, and they're left off the to-book lists for 14 days.
- **Monday email** (with reminders on): upcoming birthdays plus the top 5 people to invite near your current base.

## Home-screen icon (optional)

A Google Apps Script link can't have its own icon, so `launcher/` is a tiny page that holds the icon and opens your app. It contains no personal data, and your app link only goes in the bookmark.

1. Host the `launcher` folder for free. Either:
   - **Cloudflare Pages:** Workers & Pages → Create → Pages → *Upload assets* → drag in the `launcher` folder; or
   - **GitHub Pages:** put it in a public repo → Settings → Pages.
2. Open that page on your phone and paste your `/exec` link.
3. **iPhone:** Share → Add to Home Screen. **Android:** ⋮ → Add to Home screen.

The first time you open it from the home screen, you may need to sign in to Google once.

## Sharing with friends

Each friend gets their own private copy, and nobody can see anyone else's list.

1. They create a new blank Google Sheet.
2. **Extensions → Apps Script**: paste in `Code.gs`, then add an HTML file called `Index` and paste in `Index.html`.
3. **Deploy → New deployment → Web app** (Execute as: Me, Who has access: Only myself).
4. They open the link. On first run the app creates the `Main` and `Rules` sheets with starter headers and goals.
5. Optional: they use your launcher page with **their own** link to get the icon.

## Privacy

- Allergies, likes and dislikes are in their own **Food & preferences** section and aren't included in the Christmas list or email.
- With **"Only myself"** access, only you (signed in to Google) can open the app. Anyone else who gets the link sees a Google error page.
- The app keeps a copy of your list in your phone's browser storage so it opens instantly. **Settings → Clear saved data** removes it.
- Map lookups go through Google's geocoder from your own script. Map images come from OpenStreetMap, which only sees which map area is being viewed.
