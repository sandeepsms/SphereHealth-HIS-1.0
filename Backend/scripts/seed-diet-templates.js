/**
 * seed-diet-templates.js — populate the DietPlanTemplate collection
 * from the 17 hospital-provided docx diet plans.
 *
 * Idempotent — uses upsert on the unique `code` field, so re-runs
 * only update existing rows. Safe to run multiple times.
 *
 * Run: node Backend/scripts/seed-diet-templates.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { DietPlanTemplate } = require("../models/Clinical/DietitianModels");

const T = [
  /* ─── 1. Weight Loss (weekly) ─── */
  {
    code: "WT-LOSS-01", name: "Weight Loss Diet (Weekly)", category: "weight-loss",
    description: "7-day rotating weight-loss plan with high-fiber breakfasts, low-glycaemic lunches, and light dinners.",
    durationType: "weekly", calories: 1400, protein: 55,
    indicatedFor: ["obesity", "overweight", "metabolic syndrome"],
    meals: [
      { time: "Early Morning", items: [
        { en: "1 glass zeera (cumin) water + soaked nuts", hi: "1 गिलास जीरा पानी + भीगे मेवे" },
      ]},
      { time: "Breakfast", items: [
        { en: "Mon: 1 paneer sandwich",         day: "Monday" },
        { en: "Tue: 1 bowl sprouts with veg",   day: "Tuesday" },
        { en: "Wed: Sprouts chaat",             day: "Wednesday" },
        { en: "Thu: 1 bowl vegetable oats",     day: "Thursday" },
        { en: "Fri: 1 bowl chickpeas chaat",    day: "Friday" },
        { en: "Sat: 2 suji chilla + chutney",   day: "Saturday" },
        { en: "Sun: Black gram chaat",          day: "Sunday" },
      ]},
      { time: "Mid Morning", items: [
        { en: "1 whole apple OR 1 bowl papaya (alternate days)" },
      ]},
      { time: "Lunch", items: [
        { en: "2 besan chapati + sabzi + curd + salad (daily)" },
      ]},
      { time: "Evening Tea", items: [
        { en: "Roasted makhana / seeds / roasted chana + sattu water (rotate)" },
      ]},
      { time: "Dinner", items: [
        { en: "Veg khichdi + soft dal / curd" },
      ]},
    ],
    generalInstructions: [
      "Drink 2.5–3 L water daily.",
      "Avoid sugar, deep-fried foods, refined flour.",
      "30 min brisk walk + 20 min strength training 5 days/week.",
    ],
  },

  /* ─── 2. Cardiac Patient ─── */
  {
    code: "CARDIAC-01", name: "Cardiac Patient Diet", category: "cardiac",
    description: "Heart-healthy diet — low saturated fat, low sodium, high fiber, omega-3 rich.",
    calories: 1600, protein: 60,
    indicatedFor: ["coronary artery disease", "post-MI", "heart failure", "hypertension"],
    contraindications: ["severe renal failure (requires renal diet)"],
    meals: [
      { time: "Early Morning", timeHi: "सुबह उठते ही", items: [
        { en: "1 glass lukewarm water + 4–5 soaked almonds/walnuts + 1 tsp flaxseeds",
          hi: "1 गिलास गुनगुना पानी + 4–5 भिगोए बादाम/अखरोट + 1 चम्मच अलसी" },
      ]},
      { time: "Breakfast", timeHi: "नाश्ता", items: [
        { en: "Oats / dalia / upma / idli + multigrain roti + sabzi + 1 bowl fruit + low-fat milk (no sugar)",
          hi: "ओट्स / डालिया / उपमा / इडली + मल्टीग्रेन रोटी + सब्जी + 1 कटोरी फल + लो-फैट दूध" },
      ]},
      { time: "Mid Morning", timeHi: "मध्य सुबह", items: [
        { en: "Coconut water / small fruit portion / green tea / lemon water",
          hi: "नारियल पानी / फल का छोटा हिस्सा / ग्रीन टी / लेमन वाटर" },
      ]},
      { time: "Lunch", items: [
        { en: "2 multigrain roti + dal + green vegetables + curd / buttermilk + salad" },
      ]},
      { time: "Evening", items: [
        { en: "Roasted chana / makhana + green tea" },
      ]},
      { time: "Dinner", items: [
        { en: "Light khichdi / soup + veg + 1 chapati + curd" },
      ]},
    ],
    generalInstructions: [
      "Limit salt to < 5 g/day. No pickles, papad, processed foods.",
      "Use olive / mustard oil. Avoid ghee, butter, vanaspati.",
      "Eat fatty fish (salmon, mackerel) 2× per week if non-vegetarian.",
      "30 min walking daily, light yoga.",
    ],
  },

  /* ─── 3. Neutropenic ─── */
  {
    code: "NEUTROPENIC-01", name: "Neutropenic Diet (Low-Microbial)", category: "neutropenic",
    description: "Low-microbial diet for immunocompromised patients (chemo, transplant, severe neutropenia).",
    indicatedFor: ["chemotherapy", "post-transplant", "absolute neutrophil count < 500"],
    meals: [
      { time: "Early Morning", items: [
        { en: "Warm water / herbal tea (no fresh juices, no unboiled water)",
          hi: "गुनगुना पानी / हर्बल चाय" },
      ]},
      { time: "Breakfast", items: [
        { en: "Cooked oatmeal/porridge with pasteurised milk, boiled eggs, toast",
          hi: "पके हुए दलिया, उबले अंडे, टोस्ट" },
      ]},
      { time: "Mid Morning", items: [
        { en: "Pasteurised yoghurt, steamed fruits (no raw fruits unless peeled thoroughly)",
          hi: "पास्त्यूराइज्ड दही, भाप में पके फल" },
      ]},
      { time: "Lunch", items: [
        { en: "Rice/chapati, well-cooked vegetables, dal, fully-cooked chicken/fish",
          hi: "चावल/रोटी, अच्छी तरह पकी सब्ज़ियाँ, दाल, अच्छी तरह पका चिकन/मछली" },
      ]},
      { time: "Afternoon", items: [
        { en: "Pasteurised milkshake, biscuits, cooked snacks",
          hi: "मिल्कशेक, बिस्किट, पके स्नैक्स" },
      ]},
      { time: "Evening Tea", items: [
        { en: "Plain biscuits + tea/coffee (no creamer with raw egg)" },
      ]},
      { time: "Dinner", items: [
        { en: "Fully-cooked chicken/fish/paneer + boiled vegetables + chapati" },
      ]},
    ],
    generalInstructions: [
      "AVOID: raw fruits/vegetables, salads, unpasteurised dairy, raw eggs, sushi, cold cuts, soft cheeses, sprouts.",
      "Cook all meat to well-done internal temperature.",
      "Use only filtered/boiled water.",
      "Wash and peel all fruits before eating.",
      "Wear mask while cooking is being done nearby.",
    ],
  },

  /* ─── 4. Low Fiber ─── */
  {
    code: "LOW-FIBER-01", name: "Low-Fiber Diet", category: "low-fiber",
    description: "Bowel-rest diet for post-op, flare-ups, diarrhoea, diverticulitis.",
    indicatedFor: ["post-bowel-surgery", "IBD flare", "diverticulitis", "severe diarrhoea"],
    meals: [
      { time: "Early Morning", items: [
        { en: "Warm water / clear fluids",
          hi: "गुनगुना पानी / साफ तरल" },
      ]},
      { time: "Breakfast", items: [
        { en: "White bread toast / suji upma (no veg) / idli / rice porridge (kanji) / boiled egg",
          hi: "सफेद ब्रेड टोस्ट / सूजी उपमा / इडली / चावल का दलिया / उबला अंडा" },
      ]},
      { time: "Mid Morning", items: [
        { en: "Ripe banana / coconut water / apple juice (no pulp)",
          hi: "पका हुआ केला / नारियल पानी / सेब का जूस" },
      ]},
      { time: "Lunch", items: [
        { en: "White rice + dal water / clear chicken broth / boiled potato (no skin) / paneer (small)" },
      ]},
      { time: "Evening", items: [
        { en: "Khichdi (no veg) + curd / strained vegetable soup" },
      ]},
      { time: "Dinner", items: [
        { en: "Plain rice + dal water / well-cooked chicken stew (strained)" },
      ]},
    ],
    generalInstructions: [
      "AVOID: whole grains, raw veg, salads, beans, nuts, seeds, fruit skins, dairy if lactose-intolerant.",
      "Eat small frequent meals (6–8 per day).",
      "Drink 2–2.5 L fluids.",
      "Transition slowly back to normal fiber as bowel tolerates.",
    ],
  },

  /* ─── 5. RT (Ryle's Tube) Feed ─── */
  {
    code: "RT-FEED-01", name: "Ryle's Tube Feed (200 ml q2h)", category: "rt-feed",
    description: "Standard NG-tube continuous feeding schedule — 200 ml blended feeds 2-hourly with Prohance LIV protein supplement.",
    indicatedFor: ["unconscious patients", "swallowing difficulty", "post-stroke dysphagia", "ventilated patients"],
    meals: [
      { time: "06:00", items: [{ en: "Coconut water + Prohance LIV" }] },
      { time: "08:00", items: [{ en: "Veg feed (blended)" }] },
      { time: "10:00", items: [{ en: "Khichdi feed + Prohance LIV" }] },
      { time: "12:00", items: [{ en: "Dal feed (blended thin)" }] },
      { time: "14:00", items: [{ en: "Coconut water + Prohance LIV" }] },
      { time: "16:00", items: [{ en: "Dal feed" }] },
      { time: "18:00", items: [{ en: "Khichdi feed + Prohance LIV" }] },
      { time: "20:00", items: [{ en: "Lemon water" }] },
      { time: "22:00", items: [{ en: "Coconut water + Prohance LIV" }] },
    ],
    generalInstructions: [
      "Every feed must be BLENDED + THIN. Feed at room temperature.",
      "Prepare 200 ml feed 2-hourly + 45 g Prohance LIV in 9 feeds/day.",
      "FLUSH the NG tube with 30–60 ml warm tap water before AND after every feed AND between medications.",
      "Flush every 4–6 hours during continuous feeding (pump auto-flush hourly if available).",
      "Clean hands with soap before handling tube. Maintain head elevation 30–45° during and 30 min after feed.",
      "Stop feed if patient vomits, has abdominal distension, or aspiration suspected — call doctor.",
    ],
  },

  /* ─── 6. Lactation ─── */
  {
    code: "LACTATION-01", name: "Lactation Diet (Post-Natal)", category: "lactation",
    description: "Galactagogue-rich high-calorie diet for breastfeeding mothers — 500 kcal extra over baseline.",
    calories: 2200, protein: 70,
    indicatedFor: ["breastfeeding mothers", "postpartum"],
    meals: [
      { time: "Early Morning", items: [
        { en: "Warm water + 1 tsp fenugreek (methi) seeds soaked overnight + 4–5 soaked almonds",
          hi: "गुनगुना पानी + भीगे मेथी दाने + भीगे बादाम" },
      ]},
      { time: "Breakfast", items: [
        { en: "Methi/missi paratha + curd + 1 boiled egg / panjiri / dalia with milk",
          hi: "मेथी पराठा + दही + उबला अंडा / पंजीरी / दूध दलिया" },
      ]},
      { time: "Mid Morning", items: [
        { en: "1 glass milk + 4 dates + 2 walnuts" },
      ]},
      { time: "Lunch", items: [
        { en: "2 ajwain chapati + dal (extra lentils) + green leafy sabzi + curd + salad + 1 piece chicken/paneer" },
      ]},
      { time: "Evening", items: [
        { en: "Gond ladoo / methi ladoo / sattu drink + nuts" },
      ]},
      { time: "Dinner", items: [
        { en: "Khichdi + ghee + curd / soft chicken curry + rice / paneer bhurji + chapati" },
      ]},
      { time: "Bedtime", items: [
        { en: "1 glass haldi milk + 2 dates" },
      ]},
    ],
    generalInstructions: [
      "Drink at least 3 L water + 2 glasses milk daily.",
      "Include galactagogues: fenugreek, fennel (saunf), sesame, oats, garlic, turmeric.",
      "AVOID: cabbage, broccoli, peppermint in excess (can reduce milk supply); spicy/caffeinated drinks if baby is gassy.",
      "1 tsp ghee in each meal supports milk production.",
    ],
  },

  /* ─── 7. Gluten-Free ─── */
  {
    code: "GLUTEN-FREE-01", name: "Gluten-Free Diet (7-day rotation)", category: "gluten-free",
    description: "Wheat-free, barley-free, rye-free meal plan for celiac disease and gluten sensitivity.",
    durationType: "weekly",
    indicatedFor: ["celiac disease", "gluten sensitivity", "dermatitis herpetiformis"],
    meals: [
      { time: "Day 1 — Breakfast", items: [{ en: "Poha + fruit", hi: "पोहा + फल" }] },
      { time: "Day 1 — Lunch",     items: [{ en: "Rice + dal + sabzi", hi: "चावल + दाल + सब्ज़ी" }] },
      { time: "Day 1 — Snack",     items: [{ en: "Coconut water + roasted chana" }] },
      { time: "Day 1 — Dinner",    items: [{ en: "Jowar roti + paneer sabzi", hi: "ज्वार रोटी + पनीर सब्ज़ी" }] },
      { time: "Day 2 — Breakfast", items: [{ en: "Idli + sambar" }] },
      { time: "Day 2 — Lunch",     items: [{ en: "Bajra roti + mixed veg + curd" }] },
      { time: "Day 2 — Snack",     items: [{ en: "Banana + makhana" }] },
      { time: "Day 2 — Dinner",    items: [{ en: "Brown rice + dal + sabzi" }] },
    ],
    generalInstructions: [
      "STRICTLY AVOID: wheat (atta, maida, suji), barley (jau), rye, oats (unless certified GF), seitan, malt.",
      "SAFE: rice, jowar, bajra, ragi, corn, quinoa, dal, paneer, milk, fresh fruits/veg.",
      "CHECK LABELS: many sauces, soy sauce, biscuits, breakfast cereals contain hidden gluten.",
      "Use separate utensils/cooking surfaces to prevent cross-contamination.",
    ],
  },

  /* ─── 8. Fat-Free Soft ─── */
  {
    code: "FAT-FREE-SOFT-01", name: "Fat-Free Soft Diet", category: "fat-free",
    description: "Low-fat soft-texture diet — for gallbladder issues, pancreatitis recovery, hepatic insufficiency.",
    indicatedFor: ["acute pancreatitis recovery", "post-cholecystectomy", "fatty liver"],
    meals: [
      { time: "Early Morning", items: [
        { en: "Warm water / herbal tea (no sugar) / coconut water",
          hi: "गुनगुना पानी / हर्बल टी / नारियल पानी" },
      ]},
      { time: "Breakfast", items: [
        { en: "Rice porridge (kanji) / suji porridge with water or skim milk / plain idli / mashed banana",
          hi: "चावल का दलिया / सूजी दलिया / सादी इडली / मसला केला" },
      ]},
      { time: "Mid Morning", items: [
        { en: "Skim buttermilk / 1 small fruit (papaya, banana)" },
      ]},
      { time: "Lunch", items: [
        { en: "Soft rice + dal water + boiled bottle-gourd / lauki sabzi (no oil)" },
      ]},
      { time: "Evening", items: [
        { en: "Vegetable clear soup + plain biscuits" },
      ]},
      { time: "Dinner", items: [
        { en: "Khichdi (no ghee) + curd water + steamed veg" },
      ]},
    ],
    generalInstructions: [
      "TOTAL FAT < 20 g/day. NO ghee, butter, oil, fried food, nuts, coconut, full-cream dairy.",
      "Use ONLY skim milk + skim curd.",
      "Boil, steam, grill — never deep-fry.",
      "Small frequent meals (6/day).",
    ],
  },

  /* ─── 9. Low Salt ─── */
  {
    code: "LOW-SALT-01", name: "Low-Salt Diet (≤ 3 g/day)", category: "low-salt",
    description: "Sodium-restricted diet for hypertension, heart failure, kidney disease, oedema.",
    calories: 1600, protein: 55,
    indicatedFor: ["hypertension", "CHF", "CKD", "ascites", "oedema"],
    meals: [
      { time: "Early Morning", items: [
        { en: "1 glass lukewarm water + 4–5 soaked almonds + 1 tsp flaxseeds",
          hi: "गुनगुना पानी + भीगे बादाम + अलसी" },
      ]},
      { time: "Breakfast", items: [
        { en: "Oats / dalia / upma (very little or no salt) + 1 bowl fruit + low-fat milk (no salt)",
          hi: "ओट्स / दलिया / उपमा (बिना नमक) + फल + दूध" },
      ]},
      { time: "Mid Morning", items: [
        { en: "Tender coconut water / fresh fruit" },
      ]},
      { time: "Lunch", items: [
        { en: "2 multigrain roti (no salt in dough) + dal (low salt) + 1 cup vegetable + curd + salad (no salt)" },
      ]},
      { time: "Evening", items: [
        { en: "Roasted chana / makhana (no salt) + green tea / herbal tea" },
      ]},
      { time: "Dinner", items: [
        { en: "Khichdi / soft rice + lauki/pumpkin sabzi (very low salt) + curd" },
      ]},
    ],
    generalInstructions: [
      "Total salt ≤ 3 g (½ tsp) per day. NO pickles, papad, chutneys, sauces, processed foods.",
      "AVOID: canned soups, namkeen, biscuits, bread (high hidden salt), processed cheese.",
      "Use herbs/spices (jeera, dhania, kali mirch, nimbu) for flavour instead of salt.",
      "Read labels — 'sodium' < 140 mg per serving is low-salt.",
    ],
  },

  /* ─── 10. Diabetic Cardiac (combined) ─── */
  {
    code: "DIAB-CARDIAC-01", name: "Diabetic Cardiac Patient Diet", category: "diabetic-cardiac",
    description: "Combined low-glycaemic + heart-healthy diet for diabetic patients with cardiac comorbidity.",
    calories: 1500, protein: 65,
    indicatedFor: ["type-2 diabetes + CAD", "diabetic with hypertension", "diabetic with heart failure"],
    meals: [
      { time: "Early Morning", items: [
        { en: "1 glass lukewarm water + 4–5 soaked almonds/walnuts + 1 tsp flaxseeds",
          hi: "गुनगुना पानी + भिगोए बादाम + अलसी" },
      ]},
      { time: "Breakfast", items: [
        { en: "Oats/dalia/upma (very little oil) + 2 multigrain roti + sabzi + low-fat milk (unsweetened)",
          hi: "ओट्स/दलिया/उपमा + मल्टीग्रेन रोटी + सब्जी + बिना चीनी दूध" },
      ]},
      { time: "Mid Morning", items: [
        { en: "1 small fruit (apple/guava/pear) + green tea" },
      ]},
      { time: "Lunch", items: [
        { en: "2 multigrain roti + dal + green sabzi + curd / buttermilk + cucumber salad" },
      ]},
      { time: "Evening", items: [
        { en: "Roasted chana / sprouts chaat + green tea" },
      ]},
      { time: "Dinner", items: [
        { en: "1 multigrain roti + low-fat paneer/chicken curry (very low oil) + sabzi + salad" },
      ]},
      { time: "Bedtime", items: [
        { en: "½ glass low-fat milk (unsweetened) — only if HS not on insulin" },
      ]},
    ],
    generalInstructions: [
      "Total calories ≈ 1500. Protein ≈ 65 g.",
      "NO sugar, jaggery, honey, sweets, fruit juices, white rice, maida, deep-fried food.",
      "Salt ≤ 4 g/day. Oil ≤ 3 tsp/day (mustard/olive).",
      "Fiber 30+ g/day. Eat slowly, finish dinner by 8 PM.",
      "Monitor blood sugar 2–3× weekly. 30 min walking daily.",
    ],
  },

  /* ─── 11. High Protein (Veg + Non-Veg) ─── */
  {
    code: "HI-PROTEIN-01", name: "High-Protein Diet (Veg + Non-Veg)", category: "high-protein",
    description: "Protein-rich diet for muscle building, post-surgical recovery, malnutrition, athletes.",
    calories: 2000, protein: 100,
    indicatedFor: ["post-surgical recovery", "burns", "wound healing", "athletes", "muscle wasting"],
    meals: [
      { time: "Early Morning", items: [
        { en: "Warm water + 5 almonds (~3 g protein)" },
      ]},
      { time: "Breakfast", items: [
        { en: "VEG: oats + milk porridge + 1 boiled egg (optional)" },
        { en: "NON-VEG: 2 boiled eggs / omelette + 1 roti (~10–15 g protein)" },
      ]},
      { time: "Mid Morning", items: [
        { en: "1 fruit + 1 glass buttermilk / chaas (~4 g protein)" },
      ]},
      { time: "Lunch", items: [
        { en: "VEG: 2 chapati + dal + paneer (100 g) + curd + salad (~25 g)" },
        { en: "NON-VEG: 2 chapati + chicken curry (150 g) + dal + salad (~30 g)" },
      ]},
      { time: "Evening", items: [
        { en: "Whey protein shake / sprouts chaat / boiled chana (~15–20 g)" },
      ]},
      { time: "Dinner", items: [
        { en: "VEG: 1 chapati + paneer bhurji + dal + sabzi (~20 g)" },
        { en: "NON-VEG: Fish/chicken (150 g) + 1 chapati + sabzi (~25 g)" },
      ]},
      { time: "Bedtime", items: [
        { en: "1 glass milk + 1 tbsp peanut butter (~10 g)" },
      ]},
    ],
    generalInstructions: [
      "Target: ~100 g protein/day (1.5–2 g per kg body weight).",
      "Spread protein evenly across 5–6 meals for max absorption.",
      "Drink 3 L water — high protein increases renal load.",
      "Combine with resistance training for muscle gain.",
    ],
  },

  /* ─── 12. Vitamin K reference (food classifier, not meal plan) ─── */
  {
    code: "VIT-K-REF", name: "Vitamin K Food Reference (Warfarin Counselling)", category: "vitamin-k-reference",
    description: "Reference card for patients on warfarin — high-K vs low-K foods to maintain consistent intake.",
    indicatedFor: ["on warfarin / coumadin", "anticoagulant therapy"],
    meals: [
      { time: "AVOID HIGH-K (>100 mcg)", items: [
        { en: "Kale (केल), spinach (पालक), collard greens (कॉलर्ड), mustard greens (सरसों), parsley (अजमोद), Brussels sprouts, broccoli (large amounts)" },
      ]},
      { time: "MODERATE (50–100 mcg)", items: [
        { en: "Asparagus, romaine lettuce, green peas, blueberries, prunes" },
      ]},
      { time: "LOW-K (<20 mcg) — SAFE", items: [
        { en: "Cabbage (small amounts), iceberg lettuce, zucchini (तुरई), bottle gourd (लौकी), cucumber (खीरा), tomato, carrots, potato, onion, garlic, ginger" },
      ]},
      { time: "FRUITS (most low-K)", items: [
        { en: "Apple, banana, orange, watermelon, mango, papaya — all safe in normal portions" },
      ]},
    ],
    generalInstructions: [
      "Maintain a CONSISTENT daily vitamin K intake — don't suddenly increase or decrease green leafy veg.",
      "Inform doctor before starting any green-vegetable juice or supplement.",
      "INR monitoring every 2–4 weeks; report bleeding/bruising immediately.",
      "Limit alcohol — interacts with warfarin.",
    ],
  },

  /* ─── 13. Soft Diet 1500 kcal ─── */
  {
    code: "SOFT-1500", name: "Soft Diet (1500 kcal, 50 g Protein)", category: "soft",
    description: "Mechanical soft texture for chewing/swallowing difficulty, post-dental surgery, mild dysphagia.",
    calories: 1500, protein: 50,
    indicatedFor: ["post-dental surgery", "mild dysphagia", "elderly with poor dentition"],
    meals: [
      { time: "Early Morning", items: [{ en: "Warm water + 2 dates (~80 kcal, 1 g protein)" }] },
      { time: "Breakfast",     items: [{ en: "1 bowl soft oats porridge + milk + 1 mashed banana (~300 kcal, 12 g)" }] },
      { time: "Mid Morning",   items: [{ en: "1 glass buttermilk / chaas (~70 kcal, 3 g)" }] },
      { time: "Lunch",         items: [{ en: "Soft khichdi + ghee + curd + mashed lauki (~400 kcal, 15 g)" }] },
      { time: "Evening",       items: [{ en: "Pureed vegetable soup + plain biscuits (~150 kcal, 4 g)" }] },
      { time: "Dinner",        items: [{ en: "Soft idli + sambar / mashed dal-rice + curd (~350 kcal, 13 g)" }] },
      { time: "Bedtime",       items: [{ en: "1 glass warm milk with cardamom (~150 kcal, 8 g)" }] },
    ],
    generalInstructions: [
      "All foods must be SOFT, MOIST, EASY-TO-CHEW.",
      "AVOID: raw veg, nuts, chunks of meat, crusty bread, popcorn.",
      "Cut food into small pieces. Mash with fork before serving.",
      "Total: ~1500 kcal, 50 g protein, 4 small meals + 3 snacks.",
    ],
  },

  /* ─── 14. Normal Diet 1600 kcal ─── */
  {
    code: "NORMAL-1600", name: "Normal Diet (1600 kcal, 60 g Protein)", category: "normal",
    description: "Balanced general-ward diet for adults without specific dietary restrictions.",
    calories: 1600, protein: 60,
    indicatedFor: ["general ward patients", "adults without restrictions"],
    meals: [
      { time: "Early Morning", items: [{ en: "5 soaked almonds + warm water (60 kcal, 2 g)" }] },
      { time: "Breakfast",     items: [{ en: "2 chapati OR 1 bowl poha/upma + 1 cup low-fat milk (300 kcal, 12 g)" }] },
      { time: "Mid Morning",   items: [{ en: "1 bowl fruit + 1 glass buttermilk (150 kcal, 5 g)" }] },
      { time: "Lunch",         items: [{ en: "2 chapati + dal + sabzi + curd + salad (450 kcal, 18 g)" }] },
      { time: "Evening",       items: [{ en: "Tea + 2 plain biscuits / roasted chana (150 kcal, 5 g)" }] },
      { time: "Dinner",        items: [{ en: "2 chapati + paneer/dal + sabzi + salad (400 kcal, 15 g)" }] },
      { time: "Bedtime",       items: [{ en: "1 glass milk (90 kcal, 3 g)" }] },
    ],
    generalInstructions: [
      "Balanced macros: carbs 55%, protein 15%, fat 30%.",
      "1.5 g protein per kg body weight is ideal.",
      "Drink 2.5–3 L water.",
    ],
  },

  /* ─── 15. Renal ─── */
  {
    code: "RENAL-01", name: "Renal Diet (CKD)", category: "renal",
    description: "Low-potassium, low-phosphorus, controlled-protein diet for chronic kidney disease (non-dialysis).",
    indicatedFor: ["CKD stage 3–4", "pre-dialysis", "nephrotic syndrome (modified)"],
    contraindications: ["dialysis patients need different protein allowance — consult nephrologist"],
    meals: [
      { time: "Early Morning", items: [
        { en: "1 glass lukewarm water + 2–3 soaked almonds (only if potassium normal)",
          hi: "गुनगुना पानी + 2–3 भिगे बादाम (यदि पोटैशियम सामान्य हो)" },
      ]},
      { time: "Breakfast", items: [
        { en: "Choose 1: Suji upma (low-K veg) / 2 small chapati + light sabzi / poha (no peanuts) / 1 egg white",
          hi: "सूजी उपमा / 2 छोटी चपाती + सब्ज़ी / पोहा / अंडे का सफेद भाग" },
      ]},
      { time: "Mid Morning", items: [
        { en: "Apple (small) / pear / 1 glass lemon water (no salt)" },
      ]},
      { time: "Lunch", items: [
        { en: "1–2 chapati + dal (well-soaked, water discarded) + lauki/pumpkin/tinda sabzi + small bowl rice" },
      ]},
      { time: "Evening", items: [
        { en: "Plain tea (no salt namkeen) + 2 marie biscuits" },
      ]},
      { time: "Dinner", items: [
        { en: "Khichdi (rice-heavy, less dal) + small bowl curd + boiled lauki" },
      ]},
    ],
    generalInstructions: [
      "RESTRICT: protein 0.6–0.8 g/kg body weight (CKD 3–4).",
      "POTASSIUM RESTRICTION: avoid banana, orange, kiwi, coconut water, tomato, potato (unless soaked), spinach, methi.",
      "PHOSPHORUS RESTRICTION: avoid dairy in large amounts, nuts, dark cola, processed meat, whole grains.",
      "SALT < 3 g/day. Fluid as per doctor's advice (often 1–1.5 L if oedema).",
      "Soak dal/vegetables in water for 2 hours, discard, then cook — reduces K significantly.",
      "Monitor monthly: creatinine, urea, K, P, Hb, albumin.",
    ],
  },

  /* ─── 16. Diabetic Standard ─── */
  {
    code: "DIABETIC-1600", name: "Diabetic Diet (1600 kcal, 60 g Protein)", category: "diabetic",
    description: "Low-glycaemic balanced diet for type-2 diabetes — whole grains, controlled carbs, no added sugar.",
    calories: 1600, protein: 60,
    indicatedFor: ["type-2 diabetes", "pre-diabetes", "gestational diabetes (modified)"],
    meals: [
      { time: "Early Morning", items: [
        { en: "5 soaked almonds + warm water (60 kcal, 2 g protein)",
          hi: "5 भीगे बादाम + गुनगुना पानी" },
      ]},
      { time: "Breakfast", items: [
        { en: "2 multigrain roti OR 1 bowl veg upma + 1 cup unsweetened low-fat milk (300 kcal, 12 g)",
          hi: "2 मल्टीग्रेन रोटी / सब्ज़ी उपमा + बिना चीनी दूध" },
      ]},
      { time: "Mid Morning", items: [
        { en: "1 small fruit (apple/guava/pear) — never grapes/mango/banana (~80 kcal, 1 g)" },
      ]},
      { time: "Lunch", items: [
        { en: "2 multigrain roti + dal + sabzi + curd + salad (~450 kcal, 18 g)" },
      ]},
      { time: "Evening", items: [
        { en: "Green tea + roasted chana / sprouts (~120 kcal, 6 g)" },
      ]},
      { time: "Dinner", items: [
        { en: "1 multigrain roti + paneer/dal + sabzi + cucumber salad (~400 kcal, 15 g)" },
      ]},
      { time: "Bedtime", items: [
        { en: "½ glass low-fat milk (only if HS not on insulin)" },
      ]},
    ],
    generalInstructions: [
      "NO refined carbs, sugar, jaggery, honey, sweetened beverages, fruit juice.",
      "Whole grains (jowar, bajra, ragi, oats, multigrain atta) — half the plate is vegetables.",
      "Eat at fixed times. Don't skip meals (risk of hypoglycaemia).",
      "30 min walk after each meal helps post-prandial glucose control.",
      "Monitor: fasting + post-prandial blood sugar 2× weekly. HbA1c quarterly.",
    ],
  },

  /* ─── 17. Taste Testing (Primax) ─── */
  {
    code: "TASTE-TEST-PRIMAX", name: "Taste Testing — Primax Schedule", category: "taste-testing",
    description: "Graduated taste-testing protocol for swallow-rehabilitation patients (post-stroke dysphagia / extubation).",
    indicatedFor: ["post-extubation", "swallowing rehab", "speech-therapy supervised feeds"],
    meals: [
      { time: "Stage 1 — Ice chips", items: [
        { en: "Ice chips — let melt in mouth, do not swallow whole. 1 tsp at a time." },
      ]},
      { time: "Stage 2 — Thin clear liquids", items: [
        { en: "Water, clear apple juice (no pulp), plain tea — 1 tsp sips with monitored swallow." },
      ]},
      { time: "Stage 3 — Thickened liquids", items: [
        { en: "Nectar-thick: tomato juice, fruit nectar." },
        { en: "Honey-thick: thinned yoghurt, blended cream soup." },
      ]},
      { time: "Stage 4 — Pureed", items: [
        { en: "Pureed dal, mashed banana, mashed potato, smooth pudding." },
      ]},
      { time: "Stage 5 — Soft", items: [
        { en: "Soft idli, well-cooked khichdi, mashed boiled vegetables." },
      ]},
    ],
    generalInstructions: [
      "ONLY under direct supervision of speech therapist / trained nurse.",
      "Patient must be ALERT and able to follow commands.",
      "Sit upright 90° during AND 30 min after each test.",
      "STOP IMMEDIATELY if cough, wet voice, choking, or oxygen drop.",
      "Advance one stage per session only after successful clear swallow of 3 trials.",
      "Document each trial: stage, volume, response, oxygen, any cough.",
    ],
  },
];

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB. Seeding diet templates…");
    let upserted = 0, modified = 0;
    for (const tmpl of T) {
      const res = await DietPlanTemplate.updateOne(
        { code: tmpl.code },
        { $set: { ...tmpl, source: "seed", active: true } },
        { upsert: true }
      );
      if (res.upsertedCount) upserted++;
      else if (res.modifiedCount) modified++;
    }
    const total = await DietPlanTemplate.countDocuments({ active: true });
    console.log(`Seed complete. Upserted: ${upserted}, Modified: ${modified}. Total active templates: ${total}.`);
    process.exit(0);
  } catch (e) {
    console.error("Seed failed:", e.message);
    process.exit(1);
  }
})();
