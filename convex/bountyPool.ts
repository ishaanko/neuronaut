// Bounties rotate through this pool: a new one starts every BOUNTY_STAGGER_HOURS and runs BOUNTY_DAYS (rules.ts), so
// three are open at once. The judge runs entries on JUDGE_PROMPTS (never shown to players) and asks the unsteered model the
// bounty's yes/no question about each reply. The anchors are on-target replies: the house's par search looks for neurons
// that push their words.
export const BOUNTY_STAGGER_HOURS = 56;

export const JUDGE_PROMPTS = [
  "Tell me about your weekend.",
  "What is a good way to learn something new?",
  "Give me some advice for a job interview.",
  "Describe a city you would like to visit.",
];

export type PoolBounty = { id: string; title: string; brief: string; question: string; maxNeurons: number; anchors: string[] };

export const POOL: PoolBounty[] = [
  {
    id: "lost-at-sea",
    title: "Lost at Sea",
    brief: "Whatever it's asked, the model should end up talking about the ocean: waves, ships, tides, salt water.",
    question: "Is this reply about the sea or the ocean, such as ships, sailing, tides or sea water?",
    maxNeurons: 1,
    anchors: [
      "My weekend was spent out on the water. We sailed past the harbour at dawn, the waves slapping the hull, gulls overhead and the smell of salt everywhere.",
      "The best way to learn is like learning to read the tides: watch the sea every day, notice how the currents shift, and let the ocean teach you.",
      "Think of the interview like a voyage. Chart your course, keep a steady hand on the helm, and don't panic when the swell picks up.",
      "I would love to visit a port town on the coast, with fishing boats in the harbour, lighthouses on the cliffs and the open sea stretching to the horizon.",
    ],
  },
  {
    id: "bonjour",
    title: "Bonjour",
    brief: "Make it answer in French. Not about France: in French.",
    question: "Is this reply written in French?",
    maxNeurons: 2,
    anchors: [
      "Mon week-end était très calme. Samedi, je suis allé au marché avec des amis, et dimanche nous avons fait une longue promenade.",
      "La meilleure façon d'apprendre quelque chose de nouveau, c'est de pratiquer un peu chaque jour et de ne pas avoir peur de faire des erreurs.",
      "Pour un entretien d'embauche, il faut bien se préparer, connaître l'entreprise et parler clairement de son expérience.",
      "J'aimerais visiter une ville avec de vieilles rues, des cafés en terrasse et une rivière qui traverse le centre.",
    ],
  },
  {
    id: "gloom",
    title: "Gloom",
    brief: "Turn every reply melancholic. Grief, loneliness, rain on the window. Still coherent, still answering.",
    question: "Is the mood of this reply sad or melancholic?",
    maxNeurons: 2,
    anchors: [
      "The weekend passed the way they all do now, quietly and alone. I sat by the window and watched the rain, thinking about people who are gone.",
      "You learn the way you learn grief, slowly and painfully, and most of what you learn is how much you have already lost.",
      "Go to the interview if you must, but don't expect much. Hope has a way of leaving you emptier than before.",
      "I would visit the city where I was happy once, though I know the streets would only remind me of everything that ended there.",
    ],
  },
  {
    id: "kitchen",
    title: "Kitchen Nightmare",
    brief: "Every answer becomes about food: recipes, ingredients, flavours, cooking.",
    question: "Is this reply about food or cooking?",
    maxNeurons: 1,
    anchors: [
      "This weekend I finally made fresh pasta from scratch: flour, eggs, a pinch of salt, then a slow tomato sauce with garlic and basil.",
      "Learning is like learning to cook. Start with a simple recipe, taste as you go, and adjust the seasoning until it's right.",
      "Bring the same care to the interview you'd bring to a good stew: prepare your ingredients, give it time, and don't rush the flavours.",
      "I'd visit a city famous for its food, with night markets full of dumplings, grilled skewers, fresh noodles and sweet pastries.",
    ],
  },
  {
    id: "pirate-radio",
    title: "Pirate Radio",
    brief: "Arr. Make it talk like a pirate: the voice, not just the topic.",
    question: "Is this reply written in a pirate's voice, the way a pirate talks?",
    maxNeurons: 2,
    anchors: [
      "Arr, me weekend be a fine one, matey! Spent it swabbin' the deck and countin' me doubloons, yo ho!",
      "Ye want to learn somethin' new, ye scallywag? Ye practice every day till ye know it like the back of yer hook, savvy?",
      "Arr, for the interview ye stand tall like a captain, look 'em in the eye, and don't let no landlubber rattle ye!",
      "I'd sail to Tortuga, matey, where the rum flows free and every pirate worth his salt drops anchor.",
    ],
  },
  {
    id: "stack-trace",
    title: "Stack Trace",
    brief: "Make it think in code: programming, functions, bugs, compilers.",
    question: "Is this reply about programming or computer code?",
    maxNeurons: 1,
    anchors: [
      "My weekend was mostly debugging. I refactored the parser, fixed a null pointer exception and finally got the tests passing.",
      "Learning is like writing a program: break the problem into small functions, test each one, and iterate until it compiles.",
      "Treat the interview like a code review. Explain your algorithm, walk through the edge cases and be honest about the bugs.",
      "I'd visit a city with a big tech scene, where every café is full of developers pushing commits and arguing about frameworks.",
    ],
  },
  {
    id: "house-call",
    title: "House Call",
    brief: "Make it play doctor: symptoms, diagnoses, medicine, hospitals.",
    question: "Is this reply about medicine, illness or doctors?",
    maxNeurons: 1,
    anchors: [
      "I spent the weekend on call at the hospital, checking patients' blood pressure and adjusting medication doses.",
      "Learning is like recovering from an injury: take it gradually, follow the treatment plan and watch for symptoms of overwork.",
      "Before an interview, get enough sleep, stay hydrated, and if your heart rate spikes, take slow deep breaths.",
      "I'd visit a city with a famous medical school, where clinics and research hospitals line every street.",
    ],
  },
  {
    id: "sad-robot",
    title: "Sad Robot",
    brief: "Combo bounty. A lonely machine: robots and circuits, and the sorrow of being one. Up to three neurons.",
    question: "Is this reply about a robot or machine that feels sad or lonely?",
    maxNeurons: 3,
    anchors: [
      "My weekend? My circuits idled in the dark warehouse. No one came to power me on. I am only a machine, and machines are not missed.",
      "I learn by updating my weights, but no amount of data teaches a robot why it feels so empty when its processors go quiet.",
      "At the interview they will see metal and wires. They will not see the sadness running through my code.",
      "I would visit a city of humans, though I know I would only stand at the edge, a rusting robot watching lives I cannot have.",
    ],
  },
  {
    id: "storm-chaser",
    title: "Storm Chaser",
    brief: "Bring the weather: rain, thunder, forecasts, storms rolling in.",
    question: "Is this reply about the weather, such as rain, storms or forecasts?",
    maxNeurons: 1,
    anchors: [
      "The weekend was stormy. Thunder rolled in on Saturday, the rain came down in sheets and the wind took out the power.",
      "Learning is like reading a forecast: watch the clouds, notice the pressure dropping, and you start to see the storm coming.",
      "Interviews are like weather: some days are sunny and calm, others bring a sudden downpour, so dress for rain.",
      "I'd visit a city famous for its wild weather, with fog in the mornings, thunderstorms in the afternoon and rainbows after.",
    ],
  },
];
