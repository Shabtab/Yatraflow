// ============ FAQ content ============
// The one list behind /faq: the visible page AND the FAQPage JSON-LD read this
// module, so a crawler and a reader can never see different answers. Answers
// carry no em dash because the app's copy gate forbids it in source literals.
//
// Sections are ordered as the page shows them, and each id is the in-page
// anchor (/faq#codes is the one the invite screen links to).

export interface FaqEntry {
  question: string
  answer: string
}

export interface FaqSection {
  /** The in-page anchor id. */
  id: string
  heading: string
  entries: FaqEntry[]
}

export const FAQ_TITLE = 'YatraFlow FAQ · Is it free, who can join, offline use and your data'
export const FAQ_DESCRIPTION =
  'Straight answers about YatraFlow: free group planning, who needs an account, offline use, what we do with your trip data, and how creator guides are priced.'

/** The intro line, split around its "mail us" link. */
export const FAQ_INTRO_LEAD = 'The questions people ask before they invite their friends. If yours isn’t here, '
export const FAQ_INTRO_TAIL = ' and we’ll add it.'

export const FAQ_SECTIONS: readonly FaqSection[] = [
  {
    id: 'getting-started',
    heading: 'Getting started',
    entries: [
      {
        question: 'Do my friends need an account to see the plan?',
        answer: 'To view a shared plan, no. To join the crew (vote, add stops, log expenses), yes, a free account, because we have to know whose vote is whose. The invite link walks them through it.',
      },
      {
        question: 'Is YatraFlow free?',
        answer: 'Planning is free: unlimited trips, unlimited crew, the budget, the votes, the settle-up. Some creator guides are paid, and the creator sets that price. There’s no subscription.',
      },
      {
        question: 'Is this a booking site?',
        answer: 'No. YatraFlow plans the trip; it doesn’t book hotels, flights or trains and it doesn’t charge you on a hotel’s behalf. Every cost you see is an editable planning estimate, not a quote and not a booking.',
      },
      {
        question: 'How is this different from a group chat plus a spreadsheet?',
        answer: 'A chat can’t tell you that adding one more stop costs 2h 40m of driving, and a spreadsheet can’t tell your crew that a vote closed an hour ago. YatraFlow keeps one plan everyone edits, shows the time-and-money impact of every change before you accept it, and settles the money at the end.',
      },
      {
        question: 'How long does it take to set up a trip?',
        answer: 'Long enough to name it and pick dates. You can build a rough plan from a calculator estimate in about 30 seconds, or start from an empty trip and add stops as the group decides.',
      },
    ],
  },
  {
    id: 'the-plan-itself',
    heading: 'The plan itself',
    entries: [
      {
        question: 'What if my group keeps changing its mind?',
        answer: 'That’s the normal case. Set a closing time on a decision (the hotel, the beach day, the budget cap), and after it closes nobody can add options or change votes. An editor applies the winner and it lands in the timeline.',
      },
      {
        question: 'Can I plan without knowing exactly where we’ll stop?',
        answer: 'Yes. Add a day with a rough area and fill in stops later; the map has a lens for finding what fits in the gaps you have left.',
      },
      {
        question: 'Does it handle trains, flights and buses, or only driving?',
        answer: 'All four. Driving gets road hours and fuel maths; trains, flights and buses get their own legs, including the airport buffers people forget.',
      },
      {
        question: 'Can I print it or take it with me?',
        answer: 'Yes, print-friendly day cards, a calendar export, and a JSON export of the whole trip. All of it is yours.',
      },
    ],
  },
  {
    id: 'offline-and-devices',
    heading: 'Offline and devices',
    entries: [
      {
        question: 'Does it work when there’s no signal?',
        answer: 'The web app installs to your phone and the Android app caches the plan, so you can read it in a dead zone. Edits you make offline will sync when you’re back. Treat it as a backup, not a guarantee: screenshot the day’s plan before a long no-signal stretch.',
      },
      {
        question: 'Is there an iPhone app?',
        answer: 'Not yet. The web app installs to the iPhone home screen and works the same way.',
      },
    ],
  },
  {
    id: 'money',
    heading: 'Money',
    entries: [
      {
        question: 'How does the settle-up work?',
        answer: 'Everyone logs what they paid. YatraFlow works out who owes whom and gives the smallest number of transfers that clears the whole group, usually two or three UPI payments instead of eleven. We don’t move the money; you pay each other.',
      },
      {
        question: 'Do you take a cut of our trip spending?',
        answer: 'No. What you spend on the trip is between you, your crew and whoever you pay.',
      },
      {
        question: 'How accurate are the cost estimates?',
        answer: 'They’re built from stated assumptions: fuel price per litre, mileage, room sharing, meal tiers, entry fees, all editable, all shown. Read them as a budget you can defend, not a quote.',
      },
    ],
  },
  {
    id: 'creators-and-paid-guides',
    heading: 'Creators and paid guides',
    entries: [
      {
        question: 'What’s a creator guide?',
        answer: 'A trip a creator published with some days locked. You see the free days in full and the locked days as counts, so you know what you’re buying before you pay.',
      },
      {
        question: 'Do creators get paid?',
        answer: 'Not automatically yet. Creators can price a guide and travellers can unlock it, but payouts are still being finished, so we tell creators to start with free routes. We’d rather say that plainly than imply money is moving.',
      },
    ],
  },
  {
    id: 'your-data',
    heading: 'Your data',
    entries: [
      {
        question: 'What do you store?',
        answer: 'Your account email, the trips you create or join, the expenses you log, and the plans you publish. That’s it.',
      },
      {
        question: 'Do you sell data or show ads?',
        answer: 'No ads, no data sales, no reselling. The privacy page lists every field and how to get your data out.',
      },
      {
        question: 'Can I delete a trip or my account?',
        answer: 'Yes. Deleting a trip moves it to a trash you can restore from; deleting your account removes your data from our systems.',
      },
    ],
  },
  {
    id: 'codes',
    heading: 'Codes and links',
    entries: [
      {
        question: 'What’s the difference between an invite link and a trip code?',
        answer: 'The link opens the trip directly. The code (GOA-K7QF) is for when the link broke or was shared in a group where links get eaten, so anyone with the code can open the trip if they’re allowed in.',
      },
      {
        question: 'Someone I don’t know got the link. Can I stop them?',
        answer: 'Reset the link in the trip’s Share tab; the old one stops working. Roles are separate: a viewer can see the plan but not change it.',
      },
    ],
  },
]

/** Every entry, in page order. The visible list and the schema both read it. */
export function faqEntries(): FaqEntry[] {
  return FAQ_SECTIONS.flatMap(section => section.entries)
}

/** The FAQPage schema for /faq, built from the same list the page renders. */
export function faqJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqEntries().map(entry => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
    })),
  }
}
