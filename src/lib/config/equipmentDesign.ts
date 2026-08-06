// ─────────────────────────────────────────────────────────────────────────────
// MetalFlow Pro — Facteurs de dimensionnement des équipements (Critères de conception)
//
// La page Critères dimensionne ~100 équipements à partir du débit projet. Chaque
// calcul applique des FACTEURS D'INGÉNIERIE : marges de conception, taux de
// remplissage de cuve, % solides, rendements d'entraînement, ratios géométriques.
//
// ⚠️ Pourquoi ces valeurs doivent être configurables, et non écrites dans la formule :
//
//   • Elles varient par SITE et par BUREAU D'ÉTUDES. Une marge de conception de
//     +25 % sur un convoyeur est une convention d'ingénieur, pas une loi : selon
//     la criticité de l'équipement, la variabilité du minerai et la culture de
//     l'exploitant, le même convoyeur se dimensionne à +15 % ou +40 %.
//   • Elles varient par TYPE DE MINERAI. Un taux de remplissage de cuve de
//     flottation, un % solides en cyclone ou un ratio air/tissu de dépoussiérage
//     dépendent de la densité, de l'abrasivité et de la finesse du minerai.
//   • Elles évoluent avec la PHASE D'ÉTUDE. Un scoping study prend des marges
//     larges ; une étude de faisabilité les resserre sur des données d'essai.
//   • Les figer rendait impossible de rejouer un dimensionnement avec les
//     conventions d'un autre client — le cas d'usage central d'un bureau d'études.
//
// Organisation : groupées PAR ÉQUIPEMENT (clé = `id` de la section dans
// SECTIONS_RAW de la page Critères), plus un bloc `common` pour ce qui est
// réellement transverse. Une table plate de 60 champs serait illisible ;
// le regroupement par équipement fait que l'ingénieur qui révise le
// dimensionnement d'un broyeur ne lit que le bloc de ce broyeur.
//
// Module PUR — aucun import React/Supabase, testable isolément.
// ─────────────────────────────────────────────────────────────────────────────

/** Facteurs transverses appliqués à plusieurs sections. */
export const COMMON_DESIGN_FACTORS = {
  /**
   * Marge de conception par défaut sur le débit nominal (Q_design = Q_nominal × f).
   * Couvre la variabilité d'alimentation et les pointes de reprise.
   */
  designMarginFactor: 1.25,
} as const;

/**
 * Facteurs propres à chaque équipement, indexés par l'`id` de sa section.
 *
 * Convention de nommage : `<grandeur>Factor` pour un multiplicateur sans
 * dimension, `<grandeur>Pct` pour un pourcentage, et le suffixe d'unité sinon
 * (`...M`, `...Mps`, `...KPa`).
 */
export const EQUIPMENT_DESIGN_FACTORS = {
  // ── Manutention minerai ────────────────────────────────────────────────
  grizzly: {
    /** Marge de conception du scalpeur (plus large : reçoit le ROM brut non régulé). */
    designMarginFactor: 1.3,
    /** Ouverture des barreaux, en fraction du F80 d'alimentation concassage. */
    slotFromF80Factor: 0.8,
    /** Dimension max ROM attendue (P100), en multiple du F80. */
    topSizeFromF80Factor: 2,
    /** Capacité spécifique d'un grizzly par mètre de largeur (t/(m·h)). */
    capacityPerWidthTphM: 300,
    /** Largeur minimale constructive (m). */
    minWidthM: 1.5,
    /** Passant sous-taille typique d'un ROM primaire (%). */
    typicalUndersizePct: 70,
  },
  apron: {
    designMarginFactor: 1.3,
    /** Largeur de tablier ≈ débit × ce facteur (mm par t/h), avec un plancher. */
    widthPerTphMm: 5,
    minWidthMm: 1200,
  },
  conveyor: {
    designMarginFactor: COMMON_DESIGN_FACTORS.designMarginFactor,
    /** Vitesse de bande de conception (m/s). */
    designSpeedMps: 2.0,
    /** Largeur de courroie ≈ débit × ce facteur (mm par t/h), avec un plancher. */
    widthPerTphMm: 4,
    minWidthMm: 600,
    /** Élévation verticale supposée pour l'estimation de puissance (m). */
    assumedLiftM: 10,
    /** Rendement de l'entraînement (moteur + réducteur + tambour). */
    driveEfficiency: 0.85,
  },
  stockpile: {
    /** Autonomie de la capacité utile reprise par gravité (h). */
    liveCapacityHours: 16,
    /** Autonomie de la capacité totale, éboulis compris (h). */
    totalCapacityHours: 72,
    /** Rapport hauteur/rayon du cône de stockage (pilote le diamètre estimé). */
    coneHeightRadiusRatio: 0.5,
    /** Les alimentateurs de reprise sont dimensionnés au-dessus du nominal. */
    reclaimMarginFactor: 1.1,
  },
  silo: {
    /** Autonomie de la trémie tampon (h). */
    bufferHours: 4,
    /** Élancement hauteur/diamètre visé. */
    heightDiameterRatio: 1.5,
    /** Marge de l'extracteur en pied de silo. */
    drawoffMarginFactor: COMMON_DESIGN_FACTORS.designMarginFactor,
  },
  sampling: {
    /**
     * Masse minimale d'échantillon ≈ débit / ce diviseur (kg par t/h), plancher
     * appliqué. Substitut pratique à un calcul complet de la théorie de Gy
     * (ISO 13292) — à remplacer par le calcul de Gy dès que l'hétérogénéité
     * constitutive du minerai est caractérisée.
     */
    massPerTphDivisor: 200,
    minSampleKg: 0.5,
    /** Nombre de coupes par heure (1 coupe / 20 min). */
    cutsPerHour: 3,
    /** Ouverture de la coupe, en multiple du top size (règle anti-ségrégation). */
    cutterApertureTopSizeFactor: 3,
    /** Marge de la balance intégratrice de bande. */
    beltScaleMarginFactor: 1.3,
  },
  dedusting: {
    /** Débit d'air extrait ≈ débit minerai × ce facteur (m³/min par t/h). */
    airflowPerTph: 0.5,
    /** Ratio air/tissu d'un filtre à manches (m³/min par m², = m/min). */
    airToClothRatio: 4,
    /** Perte de charge supposée du filtre (Pa). */
    pressureDropPa: 2500,
    /** Rendement du ventilateur. */
    fanEfficiency: 0.7,
  },

  // ── Concassage ─────────────────────────────────────────────────────────
  jaw: {
    designMarginFactor: COMMON_DESIGN_FACTORS.designMarginFactor,
    /** CSS nominal, en fraction du F80 d'alimentation (F80 × f / 1000). */
    cssFromF80Factor: 12,
  },
  gyratory: {
    designMarginFactor: COMMON_DESIGN_FACTORS.designMarginFactor,
    /** Ouverture d'alimentation (gape) en multiple du F80 ROM. */
    gapeFromRomF80Factor: 1.2,
  },
  cone: {
    designMarginFactor: COMMON_DESIGN_FACTORS.designMarginFactor,
    /** CSS ≈ F80 × ce facteur, avec un plancher mécanique. */
    cssFromF80Factor: 0.6,
    minCssMm: 12,
    /** P80 produit ≈ CSS × ce facteur. */
    p80FromCssFactor: 1.5,
    /** CSS estimé en fraction du P80 visé de l'étage (secondaire ou tertiaire). */
    cssFromStageP80Factor: 0.85,
  },
  hpgr: {
    /** Marge plus faible : le HPGR tolère mal la surcharge. */
    designMarginFactor: 1.15,
    /** Énergie spécifique ≈ BWi × ce facteur (rendement HPGR vs broyage). */
    energyFromBwiFactor: 0.35,
  },
  pebble_crusher: {
    /** Débit de galets recirculés, en fraction du débit frais. */
    pebbleRecycleFraction: 0.15,
    /** Alimentation max, en fraction du F80 concassage. */
    maxFeedFromF80Factor: 0.08,
  },

  // ── Broyage ────────────────────────────────────────────────────────────
  sag: {
    /** Le SAG voit un minerai plus tenace que l'essai BWi standard. */
    bwiCorrectionFactor: 1.3,
    /** Rendement énergétique du SAG relatif à l'équation de Bond. */
    bondEnergyFactor: 0.55,
    /** Fraction volumique utile de la cuve (charge + pulpe). */
    vesselFillFraction: 0.35,
    /** Élancement L/D du broyeur. */
    lengthDiameterRatio: 1.5,
    /** Charge de boulets, en fraction du volume du broyeur. */
    ballChargeVolumeFraction: 0.11,
    /** Masse volumique apparente des corps broyants acier (t/m³). */
    mediaBulkDensityTM3: 7.8,
  },
  ag: {
    bwiCorrectionFactor: 1.2,
    bondEnergyFactor: 0.65,
  },
  ball: {
    /** Marge sur la puissance moteur installée. */
    motorMarginFactor: 1.1,
  },
  rod: {
    /** Le broyage à barres est moins efficace que l'équation de Bond ne prédit. */
    bondEnergyFactor: 1.1,
  },
  vertimill: {
    /** Le regrind broie des mixtes déjà concentrés : Wi effectif réduit. */
    bwiCorrectionFactor: 0.7,
  },
  isamill: {
    bwiCorrectionFactor: 0.6,
    /** Broyage ultrafin : surcoût énergétique vs Bond. */
    bondEnergyFactor: 1.2,
  },
  towermill: {
    bwiCorrectionFactor: 0.65,
  },

  // ── Classification ─────────────────────────────────────────────────────
  hydrocyclone: {
    /** D50 de coupure visé, en fraction du P80 de broyage. */
    d50FromP80Factor: 0.6,
    /** Corrélation de Plitt : d50c ≈ P80 / ce diviseur. */
    plittD50FromP80Divisor: 1.5,
  },
  screen: {
    /** Ouverture de maille, en multiple du P80 (mm). */
    apertureFromP80Factor: 1.5,
    /** Élancement longueur/largeur d'un crible vibrant. */
    lengthWidthRatio: 2.5,
  },

  // ── Criblage (postes dédiés) ───────────────────────────────────────────
  scalper: {
    designMarginFactor: 1.2,
  },
  reclaim: {
    designMarginFactor: COMMON_DESIGN_FACTORS.designMarginFactor,
  },
  scalp_screen: {
    /** Passant sous-taille d'un scalpeur post-primaire. */
    undersizeFraction: 0.55,
  },
  double_deck: {
    undersizeFraction: 0.75,
  },
  banana_screen: {
    undersizeFraction: 0.7,
  },
  wet_screen_hpgr: {
    /** Débit au rouleau, recyclage inclus. */
    recycleMarginFactor: COMMON_DESIGN_FACTORS.designMarginFactor,
  },

  // ── Séparation physique ────────────────────────────────────────────────
  flash_flot: {
    /** Fraction volumique utile de la cuve de flash flottation. */
    vesselFillFraction: 0.5,
    /** Débit d'air ≈ volume de cellule × ce facteur (m³ air/min par m³ cellule). */
    airPerCellVolume: 0.8,
    /** Récupération Au estimée en fraction du GRG (approximation). */
    recoveryFromGrgFactor: 0.8,
  },
  column_flot: {
    vesselFillFraction: 0.35,
    /** Eau de lavage, en fraction du débit volumique de pulpe. */
    washWaterFraction: 0.15,
  },

  // ── Traitement ─────────────────────────────────────────────────────────
  cil: {
    /**
     * Dosage charbon : concentration (g/L) × débit pulpe (m³/h) × ce facteur
     * → kg/h. Le facteur convertit g/L en kg/m³ puis applique le taux de
     * transfert charbon du circuit.
     */
    carbonTransferFactor: 0.002,
    /** Nombre de cuves du circuit (pilote le débit par tamis interstade). */
    tankCount: 6,
    /** Marge sur le volume de cuverie retenu vs le volume requis par la cinétique. */
    vesselDesignMarginFactor: 1.2,
    /** Puissance d'agitation spécifique (kW par m³ de cuve). */
    agitationKwPerM3: 0.1,
  },
  gravity: {
    /** Rapport d'enrichissement gravimétrique (concentré ≈ alimentation × ce facteur). */
    concentrateMassFraction: 0.001,
  },
  adr: {
    /** Masse volumique apparente du charbon actif (t/m³). */
    carbonBulkDensityTM3: 0.5,
  },
  smelt: {
    /** Titre en or du doré produit (fraction) — le reste est Ag et métaux communs. */
    doreGoldFraction: 0.85,
  },
  intensive_leach: {
    /** Masse de concentré gravimétrique traitée, en fraction du débit usine. */
    concentrateMassFraction: 0.002,
  },
  pox: {
    /** Consommation d'oxygène, en fraction de la masse de concentré traitée. */
    oxygenMassFraction: 0.12,
  },
  detox: {
    /** Dosage SO₂ du procédé INCO, en fraction de la masse de résidus. */
    so2MassFraction: 0.0003,
  },
  water_treat: {
    /** Part de l'eau de procédé recyclée depuis le parc à résidus. */
    recycleFraction: 0.7,
    /** Part d'eau fraîche d'appoint (complément du recyclage). */
    makeupFraction: 0.3,
  },
  thickener: {
    /** Flux spécifique de filtration en aval (t/(m²·h)). */
    specificFluxTM2H: 0.10,
  },
  power_supply: {
    /** Marge d'installation appliquée à la puissance de broyage estimée. */
    installedMarginFactor: 1.3,
    /** Puissance connectée = puissance installée × ce facteur. */
    connectedMarginFactor: 1.15,
    /** Groupe électrogène de secours, en fraction de la puissance installée. */
    standbyFraction: 0.15,
    /** Plancher de puissance usine (kW) pour un très petit débit. */
    minPlantKw: 100,
  },
  lime_prep: {
    /** Marge sur la capacité de l'extincteur de chaux. */
    slakerMarginFactor: 1.3,
  },

  // ── Services & résidus ─────────────────────────────────────────────────
  water_sys: {
    /** Besoin en eau brute ≈ débit × ce facteur (m³/h par t/h). */
    waterPerTph: 2.5,
    /** Part du besoin total consommée par le circuit CIL/CIP. */
    leachShareFraction: 0.6,
  },
  compressed_air: {
    /** Air instrument ≈ débit × ce facteur (m³/min par t/h). */
    instrumentAirPerTph: 0.05,
  },
  pumps: {
    /** Marge sur la capacité des pompes à pulpe. */
    designMarginFactor: 1.2,
    /** % solides volumique en conduite de pulpe. */
    slurrySolidsFraction: 0.35,
  },
  tailings: {
    /** % solides des résidus épaissis envoyés au parc. */
    thickenedSolidsFraction: 0.4,
    /** Fraction du débit d'alimentation qui part en résidus (≈ totalité). */
    tailingsMassFraction: 0.999,
  },
  filtration: {
    /** Densité de pulpe supposée en amont de la filtration (t/m³). */
    slurryDensityTM3: 1.5,
    /** Flux de filtration spécifique (m³/(m²·h)). */
    specificFluxM3M2H: 0.1,
  },
  effluent: {
    /** Volume d'effluents à traiter, en fraction du débit minerai (m³/h par t/h). */
    effluentPerTph: 0.1,
  },
  power: {
    /**
     * Facteur d'installation appliqué à la puissance de broyage pour estimer la
     * puissance totale usine (auxiliaires, pompage, services, éclairage).
     */
    plantTotalFromGrindingFactor: 1.4,
  },
} as const;

/** Type de la table, pour les consommateurs qui veulent l'indexer dynamiquement. */
export type EquipmentDesignFactors = typeof EQUIPMENT_DESIGN_FACTORS;
