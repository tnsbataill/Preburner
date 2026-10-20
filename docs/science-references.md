# Science references

What each part of the engine rests on, checked against the papers (October 2026). Each row gives the code constant, the source, what the source found, and a verdict:

- **Supports**: the constant is what the paper found or recommends.
- **Partly**: the direction matches, but the value, population or method differs.
- **Our choice**: an engineering choice the literature is consistent with, but no paper gives the value.
- **Not verified**: the full text wasn't checked.

Values that are pure tuning (no paper behind the exact number) are listed at the end.

## Fuelling (`src/engine/`)

| Code / value | Source | What it found | Verdict |
|---|---|---|---|
| Daily carb bands 3–12 g/kg (`CARB_BANDS`) | [Thomas, Erdman & Burke 2016, *MSSE* 48:543](https://pubmed.ncbi.nlm.nih.gov/26891166/) (ACSM / AND / Dietitians of Canada joint position) | 3–10 g/kg/day scaled to load, about 12 for extreme days | Supports (the paper's own table wasn't checked) |
| In-ride g/h by duration: none under 45 min, 30–60, up to 90 past 2.5 h (`duringCarbPerHour`) | [Burke, Hawley, Wong & Jeukendrup 2011, *J Sports Sci* 29:S17](https://doi.org/10.1080/02640414.2011.585473); [Jeukendrup 2014, *Sports Med* 44:S25](https://pubmed.ncbi.nlm.nih.gov/24791914/) | Small amounts or a mouth rinse around 1 h; 30–60 g/h for longer; up to 90 g/h past 2.5 h. Jeukendrup lowers intake at low absolute intensity | Supports; the IF scaling matches Jeukendrup in direction |
| Glucose + fructose above 60 g/h (`splitSugars`) | [Currell & Jeukendrup 2008, *MSSE* 40:275](https://pubmed.ncbi.nlm.nih.gov/18202575/) | 2:1 glucose:fructose at 1.8 g/min: time trial about 8% faster than glucose alone (n = 8) | Supports |
| Fructose:glucose 0.8 (`fructoseRatio`) | [Rowlands et al. 2015, *Sports Med*](https://www.springermedicine.com/fructose-glucose-composite-carbohydrates-and-endurance-performan/22254370) | At 1.5–1.8 g/min, 0.8:1 gave the most exogenous carbohydrate energy and power | Partly: studied at 90–108 g/h; we split from 60 g/h |
| Carb share of energy vs IF (`carbFraction`) | Brooks & Mercier 1994, *J Appl Physiol* (citation details not verified) | Carbohydrate takes over from fat as intensity rises; crossover near 55% VO2max on average, with large individual spread | Our choice: the shape matches; the breakpoints are ours |
| Recovery carbs within 20–45 min (`scheduler.ts`) | [Ivy et al. 1988, *J Appl Physiol* 64:1480](https://pubmed.ncbi.nlm.nih.gov/3132449/) | Delaying carbohydrate 2 h roughly halved glycogen storage | Supports timing. The 1.0–1.2 g/kg/h rate is the position-stand range (not verified) |
| Pre-ride meal 1.0–2.5 g/kg, 2–5 h out; race breakfast 2.5 g/kg about 3 h out | Thomas 2016; Burke 2011 (above) | Position-stand range of 1–4 g/kg, 1–4 h before | Our choice inside the range (not verified against the table) |
| Carb-load 10 g/kg the day before a race of 2.5 h+ (`dailyCarbGrams`) | [Bussau et al. 2002, *Eur J Appl Physiol* 87:290](https://researchportal.murdoch.edu.au/esploro/outputs/journalArticle/Carbohydrate-loading-in-human-muscle-an/991005540488207891) | 10 g/kg for one day filled muscle glycogen in 24 h (n = 8, glycogen only, no performance test) | Supports the amount. They rested; our plans put openers the day before |
| Pre-sleep protein at least 40 g, capped at 30% of daily protein (`distributeMacros`) | [Res et al. 2012, *MSSE* 44:1560](https://pubmed.ncbi.nlm.nih.gov/22330017/) | 40 g casein 30 min before sleep raised overnight protein synthesis and balance | Supports (studied after evening resistance exercise) |
| Protein 1.8 g/kg (`proteinGPerKg`) | [Morton et al. 2018, *BJSM* 52:376](https://pubmed.ncbi.nlm.nih.gov/28698222/) | No extra lean-mass gain beyond about 1.62 g/kg/day | Partly: the data come from people doing resistance training |
| Fluid and sodium from sweat rate (`duringFluid`) | [ACSM Exercise and Fluid Replacement 2007 (Sawka, Burke et al.), *MSSE* 39:377](https://pubmed.ncbi.nlm.nih.gov/17277604/) | Personalise to measured sweat rate; avoid losing more than 2% of body weight to dehydration | Supports. The 700 mg/L default is the top of the 1996 stand's 0.5–0.7 g/L |
| Resting energy (`mifflinBmr`) | [Mifflin et al. 1990, *AJCN* 51:241](https://doi.org/10.1093/ajcn/51.2.241) | The equation used here; Harris-Benedict overestimated by 5% | Supports |
| Gross efficiency 20–24% (`EFFICIENCY_PRESETS`) | [Ettema & Lorås 2009, *Eur J Appl Physiol* 106:1](https://www.iat.uni-leipzig.de/datenbanken/iks/bdr/Record/4031610) | Defines gross efficiency; measurement isn't standardised | Our choice (preset values not verified) |
| Energy-availability floors: 30 (F), 25 (M) kcal/kg FFM (`EA_FLOOR`) | [Loucks, Kiens & Wright 2011, *J Sports Sci* 29:S7](https://pubmed.ncbi.nlm.nih.gov/21793767/); [Koehler et al. 2016, *J Sports Sci* 34:1921](https://doi.org/10.1080/02640414.2016.1142109); [male-threshold review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11194298/); [Mountjoy et al. 2023 IOC REDs, *BJSM* 57:1073](https://pubmed.ncbi.nlm.nih.gov/37752011/) | 30 is the classic female threshold. Koehler saw leptin and insulin fall at 15 vs 40 but set no threshold; reviews propose 9–25 for men. The IOC treats low EA as a spectrum | Partly: 25 is the cautious end of an unsettled range; a fixed floor is a simplification |
| Weight-loss cap of 1%/wk, warning past 0.7% (`resolveWeeklyRate`) | [Garthe et al. 2011, *IJSNEM* 21:97](https://lida.sport-iat.de/ta/Record/4020931?lng=en) | 0.7%/wk kept lean mass and strength better than 1.4%/wk | Supports (studied in strength athletes) |
| 7700 kcal per kg lost (`KCAL_PER_KG_TISSUE`) | [Hall 2008, *Int J Obes* 32:573](https://pubmed.ncbi.nlm.nih.gov/17848938/); [Thomas et al. 2013, *Int J Obes*](https://www.doi.org/10.1038/ijo.2013.51) | Lean people need less deficit per kg lost, because more of the loss is lean tissue. The fixed rule also overpredicts loss over time as expenditure adapts | Beyond the evidence: treat projected weight change as optimistic |
| Weight trend (`weightTrend`) | Walker, *The Hacker's Diet* (book) | Exponentially smoothed trend line | Convention, not experimental evidence |
| Glycogen tank (`glycogen.ts`) | Ivy 1988 (refill faster soon after exercise); Currell 2008 (multi-transporter ceiling) | n/a | Our choice: display only; prescriptions come from the bands |

## Training plans (`src/training/`)

| Code / value | Source | What it found | Verdict |
|---|---|---|---|
| Intensity mix is a tunable gene; fitness saturates with volume (`model.ts`) | [Cove et al., *J Sci Med Sport* 28:423, doi 10.1016/j.jsams.2024.12.005](https://doi.org/10.1016/j.jsams.2024.12.005) | 41 studies, 797 cyclists: polarised and non-polarised gave similar VO2max and time-trial gains; longer interventions helped; training volume showed no association | Supports |
| VO2 domain gets its own weight (`wHigh`) | [Oliveira, Boppre & Fonseca 2024, *Sports Med*](https://pmc.ncbi.nlm.nih.gov/articles/PMC11329428/) | Small polarised advantage for VO2peak (SMD 0.24, 11 studies); gone in interventions over 12 weeks; larger in highly trained athletes | Supports, weakly. Per-domain weights aren't identifiable from real data, so they stay at the prior |
| At least 60% of riding time below 76% FTP (`MIN_LOW_TIME_SHARE`) | [Seiler 2010, *IJSPP* 5:276](https://lida.sport-iat.de/ta/Record/4020753?lng=en) | Elite endurance athletes do about 80% of *sessions* at low intensity | Our choice: deliberately looser than the elite pattern (see results doc) |
| At most 3 hard days a week, never back to back; at most 2 VO2+ | Seiler 2010 (above) | Mostly easy volume with a few hard sessions | Our choice, consistent with practice; no trial sets these numbers |
| Taper / test-week multipliers (`generator.ts`) | [Bosquet et al. 2007, *MSSE* 39:1358](https://pubmed.ncbi.nlm.nih.gov/17762369/) | Best: 2 weeks, volume cut 41–60% exponentially, intensity and frequency kept | Supports |
| Fitness-fatigue model (`model.ts`, `fitness.ts`) | Banister et al. 1975 (venue not verified); [Calvert, Banister, Savage & Bach 1976, *IEEE Trans SMC*](https://independent.academia.edu/TimBach1) | Performance modelled as fitness minus fatigue | Supports |
| Variable-dose fatigue (`busso`) | [Busso 2003, *MSSE* 35:1188](https://lida.sport-iat.de/ta/Record/4008669?lng=en) | Fatigue response grows with recent load; inverted-U relation between daily training and performance (n = 6, 15 weeks) | Supports |
| Fit pulled toward population priors (`fit.ts`) | [Hellard et al. 2006, *J Sports Sci* 24:509](https://pmc.ncbi.nlm.nih.gov/articles/pmid/16608765) | Banister fits matched the data (R² ≈ 0.79), but the parameters had wide confidence intervals and were highly correlated | Supports the use of priors |
| Truth model with PerPot-style overload (`sim/truth.ts`) | [Pfeiffer 2008, *IJCSS* 7(2):13](https://lida.sport-iat.de/ta/Record/4015301?lng=en) | PerPot fit better in 9 of 15 subjects; the fitness-fatigue model predicted better in 8 of 15 | Partly: the evidence is mixed. A Pfeiffer 2010 paper wasn't found |
| TSS = h·IF²·100; NP-style 4th-power IF (`library.ts`) | Allen & Coggan, *Training and Racing with a Power Meter* (book) | The formulas used | Convention, not experimental evidence |
| HRV readiness: 7-day lnRMSSD vs 60-day mean − 1.0 SD; low side only (`adapt.ts`) | [Vesterinen et al. 2016, *MSSE* 48:1347](https://jyx.jyu.fi/handle/123456789/50625); [Javaloyes et al. 2019, *IJSPP* 14:23](https://dspace.umh.es/handle/11000/30650); [Plews et al. 2012, *Eur J Appl Physiol*](https://pubmed.ncbi.nlm.nih.gov/22367011/); [Plews et al. 2013, *Sports Med* 43:773](https://openrepository.aut.ac.nz/handle/10292/7122) | HRV-guided groups did as well or better with fewer hard sessions. Vesterinen set the band at mean ± 0.5 SD over a 4-week baseline, and HRV outside it in either direction meant easy days | Partly: our band is twice as wide (0.5 SD cost FTP gain in simulation) and ignores high HRV |
| Expected effect of daily adaptation | [HRV-guided training meta-analysis 2021, *IJERPH*](https://pmc.ncbi.nlm.nih.gov/articles/PMC8507742/); [Granero-Gallegos et al. 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7663087/) | Small, non-significant performance gains; possibly fewer non-responders | Consistent with our simulation (neutral on FTP, fewer sick days) |
| Monotony / strain | [Foster 1998, *MSSE* 30:1164](https://lida.sport-iat.de/ta/Record/4001707?lng=en) | Illness clustered when training strain (load × monotony) passed individual thresholds | Not implemented. The optimiser only penalises TSB below −30 |

## Tuning with no paper behind the exact value

- In-ride IF scale factors (0.6 / 0.85 / 1.15 / 1.25) and the duration tiers' base values.
- Pre-snack 0.25–0.5 g/kg; recovery 0.6–1.2 g/kg; tomorrow top-up 0.5–1.5 g/kg.
- Replacing 70% of sweat loss, 1 L/h cap, ×1.25 sweat indoors.
- Deficit weights (easy 1, moderate 0.6), 700 kcal/day cap, 25% of TDEE cap.
- Model priors (`PRIOR` in `model.ts`), the genome grid, risk aversion 0.5 SD, the TSB −30 penalty, the 4% model-error SD (measured on one rider's data, n = 9).
- Readiness thresholds: RHR +3 bpm, TSB −35, two markers for red.
