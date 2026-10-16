// Éditeur des hypothèses du module Coûts miniers (ciel ouvert / souterrain).
// Chaque champ montre sa provenance ; toute saisie devient une surcharge
// persistée, les autres valeurs restant liées aux données du projet.

import { formatDecimalGrouped } from '../../../lib/format/number';
import type { LabourRate, MobileEquipmentSpec, StaffLine } from '../../../lib/mining/types';
import type { HeadingCostBreakdown, InfrastructureItem, StopeMethod, UgFleetItem } from '../../../lib/mining/underground';
import type { LoadingUnitInput, SupportUnitInput } from '../../../lib/mining/openPit';
import { ArrayTable, NumField, ProvenanceBadge, Section } from './fields';
import { provenanceOf } from './provenance';
import type { MiningCostState } from './useMiningCostModel';

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6">{children}</div>;
}

function SelectField({ state, path, label, options }: {
  state: MiningCostState; path: string; label: string; options: { value: string; label: string }[];
}) {
  const v = String(state.valueAt(path) ?? '');
  return (
    <label className="flex items-center gap-2 text-xs py-0.5">
      <span className="mf-txt3 flex-1 min-w-0 truncate">{label}</span>
      <select className="input-field text-xs py-0.5 w-56" value={v} onChange={e => state.setOverride(path, e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="w-[68px] shrink-0"><ProvenanceBadge p={provenanceOf(state, path)} /></span>
    </label>
  );
}

function ScheduleSection({ state }: { state: MiningCostState }) {
  const ug = state.model?.method === 'underground';
  return (
    <Section title="Calendrier de production" subtitle="— débit usine, durée de vie, réserves" defaultOpen>
      <Grid>
        <div>
          <NumField state={state} path="schedule.annualOreTonnes" label="Minerai alimenté (régime établi)" unit="Mt/an" scale={1e-6} digits={3} />
          <NumField state={state} path="schedule.lomYears" label="Durée de vie de la mine" unit="ans" step="1" />
          <NumField state={state} path="schedule.reservesTonnes" label="Réserves (0 = non plafonné)" unit="Mt" scale={1e-6} digits={3} />
          <NumField state={state} path={ug ? 'schedule.preProductionYearsUnderground' : 'schedule.preProductionYearsOpenPit'} label="Années de pré-production" unit="ans" step="1" />
        </div>
        <div>
          <NumField state={state} path="schedule.rampUpY1Pct" label="Montée en cadence — année 1" unit="%" />
          <NumField state={state} path="schedule.rampUpY2Pct" label="Montée en cadence — année 2" unit="%" />
          {!ug && <NumField state={state} path="schedule.strippingRatio" label="Ratio de découverture" unit="t/t" />}
          {!ug && (
            <label className="flex items-center gap-2 text-xs py-0.5">
              <span className="mf-txt3 flex-1">Ratio annuel des phases Mine & Optimisation ({state.phaseCount})</span>
              <input type="checkbox" disabled={state.phaseCount === 0}
                checked={Boolean(state.valueAt('schedule.useMinePhases'))}
                onChange={e => state.setOverride('schedule.useMinePhases', e.target.checked)} />
              <span className="w-[68px] shrink-0"><ProvenanceBadge p={provenanceOf(state, 'schedule.useMinePhases')} /></span>
            </label>
          )}
        </div>
      </Grid>
    </Section>
  );
}

function RatesSection({ state, prefix, roles }: { state: MiningCostState; prefix: 'openPit' | 'underground'; roles: { key: string; label: string }[] }) {
  const rates = (state.valueAt(`${prefix}.rates`) as LabourRate[] | undefined) ?? [];
  const rateOptions = rates.map(r => ({ value: r.id, label: r.label }));
  return (
    <Section title="Main-d'œuvre" subtitle="— taux (coût total employeur), rôles et effectifs">
      <ArrayTable<LabourRate & Record<string, unknown>>
        state={state} path={`${prefix}.rates`} title="Taux"
        rowKey={r => r.id}
        columns={[
          { key: 'label', label: 'Poste', type: 'text', width: 'w-56' },
          { key: 'payBasis', label: 'Base', type: 'select', options: [{ value: 'hourly', label: 'Horaire' }, { value: 'salary', label: 'Salaire' }] },
          { key: 'hourlyRate', label: 'US$/h' },
          { key: 'annualSalary', label: 'US$/an', width: 'w-24' },
          { key: 'bonusPct', label: 'Prime %' },
          { key: 'burdenPct', label: 'Charges %' },
          { key: 'siteCostsUsdYr', label: 'Coûts site US$/an', width: 'w-24' },
        ]}
        newRow={() => ({ id: `rate_${Date.now()}`, label: 'Nouveau poste', payBasis: 'hourly', hourlyRate: 0, annualSalary: 0, bonusPct: 0, burdenPct: 0, siteCostsUsdYr: 0 })}
      />
      <div className="mt-3 text-[10px] font-semibold mf-txt3 uppercase tracking-wider">Rôles</div>
      <Grid>
        {roles.map(r => <SelectField key={r.key} state={state} path={`${prefix}.roleRates.${r.key}`} label={r.label} options={rateOptions} />)}
      </Grid>
      <div className="mt-3">
        <ArrayTable<StaffLine & Record<string, unknown>>
          state={state} path={`${prefix}.staff`} title={prefix === 'openPit' ? 'Cadres & personnel technique' : 'Personnel indirect (encadrement, technique, services)'}
          rowKey={r => r.id}
          columns={[
            { key: 'department', label: 'Service', type: 'text', width: 'w-40' },
            { key: 'rateId', label: 'Poste', type: 'select', options: rateOptions },
            { key: 'count', label: 'Effectif' },
          ]}
          newRow={() => ({ id: `staff_${Date.now()}`, rateId: rates[0]?.id ?? '', count: 1, department: '' })}
        />
      </div>
    </Section>
  );
}

function OpenPitEditor({ state }: { state: MiningCostState }) {
  const equipment = (state.valueAt('openPit.equipment') as MobileEquipmentSpec[] | undefined) ?? [];
  const eqOptions = equipment.map(e => ({ value: e.id, label: e.label }));
  return (
    <div className="space-y-2">
      <ScheduleSection state={state} />
      <Section title="Calendrier d'exploitation" subtitle="— postes, temps productif, disponibilité (Magino OpParms)">
        <Grid>
          <div>
            <NumField state={state} path="openPit.hoursPerShift" label="Heures par poste" unit="h" />
            <NumField state={state} path="openPit.shiftsPerDay" label="Postes par jour" unit="" step="1" />
            <NumField state={state} path="openPit.operatingDaysPerYear" label="Jours d'exploitation" unit="j/an" step="1" />
            <NumField state={state} path="openPit.lostShiftsPerYear" label="Postes perdus (météo, fériés)" unit="postes/an" step="1" />
            <NumField state={state} path="openPit.crews" label="Équipes en rotation" unit="" step="1" />
          </div>
          <div>
            <NumField state={state} path="openPit.nonProductiveMinPerShift" label="Temps non productif programmé" unit="min/poste" />
            <NumField state={state} path="openPit.jobEfficiencyMinPerHour" label="Efficacité de travail" unit="min/h" />
            <NumField state={state} path="openPit.mechanicalAvailabilityPct" label="Disponibilité mécanique" unit="%" />
            <NumField state={state} path="openPit.useOfAvailabilityPct" label="Utilisation de la disponibilité" unit="%" />
          </div>
        </Grid>
      </Section>
      <Section title="Matériau, forage & sautage" subtitle="— géométrie du tir, explosif (Magino Blast)">
        <Grid>
          <div>
            <NumField state={state} path="openPit.oreSgTpm3" label="Densité du minerai" unit="t/m³" />
            <NumField state={state} path="openPit.wasteSgTpm3" label="Densité du stérile" unit="t/m³" />
            <NumField state={state} path="openPit.swellFraction" label="Foisonnement" unit="%" scale={100} />
            <NumField state={state} path="openPit.benchHeightM" label="Hauteur de banc" unit="m" />
            <SelectField state={state} path="openPit.drillEquipmentId" label="Foreuse" options={eqOptions} />
            <NumField state={state} path="openPit.holeDiameterMm" label="Diamètre de trou" unit="mm" />
            <NumField state={state} path="openPit.burdenToDiameter" label="Banquette / diamètre" unit="×D" />
            <NumField state={state} path="openPit.spacingToBurden" label="Espacement / banquette" unit="×B" />
            <NumField state={state} path="openPit.subdrillToBurden" label="Surforation / banquette" unit="×B" />
            <NumField state={state} path="openPit.stemmingToBurden" label="Bourrage / banquette" unit="×B" />
            <NumField state={state} path="openPit.penetrationMph" label="Vitesse de foration" unit="m/h" />
          </div>
          <div>
            <NumField state={state} path="openPit.emulsionWeightFraction" label="Part d'émulsion (reste ANFO)" unit="%" scale={100} />
            <NumField state={state} path="openPit.emulsionSg" label="Densité de l'émulsion" unit="t/m³" />
            <NumField state={state} path="openPit.emulsionUsdKg" label="Prix de l'émulsion" unit="US$/kg" />
            <NumField state={state} path="openPit.prillSg" label="Densité du nitrate (prills)" unit="t/m³" />
            <NumField state={state} path="openPit.prillUsdKg" label="Prix du nitrate" unit="US$/kg" />
            <NumField state={state} path="openPit.anfoFuelWeightFraction" label="Gazole dans l'ANFO" unit="%" scale={100} />
            <NumField state={state} path="openPit.fuelOilSg" label="Densité du gazole" unit="t/m³" />
            <NumField state={state} path="openPit.initiationUsdPerHole" label="Amorçage par trou" unit="US$" />
            <NumField state={state} path="openPit.blastingFixedUsdPerYear" label="Frais fixes artificier" unit="US$/an" />
          </div>
        </Grid>
      </Section>
      <Section title="Chargement, transport & soutien" subtitle="— productivité et ratios de flotte">
        <ArrayTable<LoadingUnitInput & Record<string, unknown>>
          state={state} path="openPit.loading" title="Engins de chargement"
          rowKey={(r, i) => `${r.equipmentId}-${i}`}
          columns={[
            { key: 'equipmentId', label: 'Engin', type: 'select', options: eqOptions },
            { key: 'bucketM3', label: 'Godet m³' },
            { key: 'fillFactor', label: 'Remplissage' },
            { key: 'cycleSec', label: 'Cycle s' },
            { key: 'share', label: 'Part %', scale: 100 },
          ]}
          newRow={() => ({ equipmentId: equipment[0]?.id ?? '', bucketM3: 0, fillFactor: 1, cycleSec: 0, share: 0 })}
        />
        <div className="mt-2">
          <Grid>
            <div>
              <SelectField state={state} path="openPit.truckEquipmentId" label="Tombereau" options={eqOptions} />
              <NumField state={state} path="openPit.truckPayloadT" label="Charge utile" unit="t" />
              <NumField state={state} path="openPit.haulDistanceKm" label="Distance de roulage (aller)" unit="km" />
            </div>
            <div>
              <NumField state={state} path="openPit.loadedSpeedKmh" label="Vitesse en charge" unit="km/h" />
              <NumField state={state} path="openPit.emptySpeedKmh" label="Vitesse à vide" unit="km/h" />
              <NumField state={state} path="openPit.spotAndDumpMin" label="Mise en place + déversement" unit="min" />
            </div>
          </Grid>
        </div>
        <div className="mt-2">
          <ArrayTable<SupportUnitInput & Record<string, unknown>>
            state={state} path="openPit.support" title="Engins de soutien (par unité de chargement)"
            rowKey={(r, i) => `${r.equipmentId}-${i}`}
            columns={[
              { key: 'equipmentId', label: 'Engin', type: 'select', options: eqOptions },
              { key: 'unitsPerLoadingUnit', label: 'Unités / unité de chargement' },
            ]}
            newRow={() => ({ equipmentId: equipment[0]?.id ?? '', unitsPerLoadingUnit: 0 })}
          />
        </div>
      </Section>
      <Section title="Coût horaire des engins" subtitle="— catalogue et facteurs (Magino EquipCost)">
        <Grid>
          <div>
            <NumField state={state} path="openPit.costFactors.dieselUsdL" label="Gazole" unit="US$/L" />
            <NumField state={state} path="openPit.costFactors.electricityUsdKwh" label="Électricité" unit="US$/kWh" />
            <NumField state={state} path="openPit.costFactors.lubeUsdL" label="Lubrifiants" unit="US$/L" />
            <NumField state={state} path="openPit.costFactors.abrasionIndex" label="Indice d'abrasivité (1 fort … 5 faible)" unit="" />
          </div>
          <div>
            <NumField state={state} path="openPit.costFactors.partsFactor" label="Facteur pièces" unit="×" />
            <NumField state={state} path="openPit.costFactors.tireFactor" label="Facteur pneus" unit="×" />
            <NumField state={state} path="openPit.costFactors.maintLabourFactor" label="Facteur heures de maintenance" unit="×" />
          </div>
        </Grid>
        <div className="mt-2">
          <ArrayTable<MobileEquipmentSpec & Record<string, unknown>>
            state={state} path="openPit.equipment" title="Catalogue des engins"
            rowKey={r => r.id}
            columns={[
              { key: 'label', label: 'Engin', type: 'text', width: 'w-56' },
              { key: 'deliveredPriceUsd', label: 'Prix livré US$', width: 'w-24' },
              { key: 'lifeHours', label: 'Vie h' },
              { key: 'partsFactorPerKusd', label: 'Pièces $/h/k$' },
              { key: 'fuelLph', label: 'Gazole L/h' },
              { key: 'powerKw', label: 'kW' },
              { key: 'lubeLph', label: 'Lubr. L/h' },
              { key: 'tireCount', label: 'Pneus' },
              { key: 'tireListPriceUsd', label: 'Pneu US$' },
              { key: 'tireLifeHours', label: 'Pneu h' },
              { key: 'wearPartsFactorPerKusd', label: 'Usure $/h/k$' },
              { key: 'bitsSteelFactorPerKusd', label: 'Taillants $/h/k$' },
              { key: 'maintHoursPerOpHour', label: 'Maint. h/h' },
            ]}
            newRow={() => ({ id: `eq_${Date.now()}`, label: 'Nouvel engin', deliveredPriceUsd: 0, lifeHours: 0, partsFactorPerKusd: 0, fuelLph: 0, powerKw: 0, lubeLph: 0, tireCount: 0, tireListPriceUsd: 0, tireLifeHours: 0, wearPartsFactorPerKusd: 0, bitsSteelFactorPerKusd: 0, maintHoursPerOpHour: 0 })}
          />
        </div>
      </Section>
      <RatesSection state={state} prefix="openPit" roles={[
        { key: 'drillOperator', label: 'Opérateur de foreuse' },
        { key: 'loaderOperator', label: 'Opérateur de chargement' },
        { key: 'truckOperator', label: 'Conducteur de tombereau' },
        { key: 'supportOperator', label: 'Opérateur engins de soutien' },
        { key: 'blaster', label: 'Boutefeu' },
        { key: 'labourer', label: 'Manœuvre' },
        { key: 'mechanic', label: 'Mécanicien (heures de maintenance)' },
        { key: 'fuelLubeTech', label: 'Graisseur' },
        { key: 'tireTech', label: 'Pneumaticien' },
      ]} />
      <Section title="Frais généraux & capital" subtitle="— effectifs fixes, consommables, capital annexe, contingence">
        <Grid>
          <div>
            <NumField state={state} path="openPit.fixedHourly.blasters" label="Boutefeux" unit="pers." step="1" />
            <NumField state={state} path="openPit.fixedHourly.labourers" label="Manœuvres" unit="pers." step="1" />
            <NumField state={state} path="openPit.fixedHourly.fuelLubeTechs" label="Graisseurs" unit="pers." step="1" />
            <NumField state={state} path="openPit.fixedHourly.tireTechs" label="Pneumaticiens" unit="pers." step="1" />
            <NumField state={state} path="openPit.adminConsumablesPctOfSalaries" label="Consommables d'administration" unit="% sal." />
            <NumField state={state} path="openPit.servicesConsumablesUsdPerYear" label="Consommables des services miniers" unit="US$/an" />
            <NumField state={state} path="openPit.labourContingencyPct" label="Contingence main-d'œuvre" unit="%" />
          </div>
          <div>
            <NumField state={state} path="openPit.smallEquipmentPctOfMajor" label="Petits équipements" unit="% engins" />
            <NumField state={state} path="openPit.initialSparesPctOfMajor" label="Pièces de rechange" unit="% engins" />
            <NumField state={state} path="openPit.shopToolsPctOfMajor" label="Outillage d'atelier" unit="% engins" />
            <NumField state={state} path="openPit.contingencyPct" label="Contingence du capital initial" unit="%" />
          </div>
        </Grid>
      </Section>
    </div>
  );
}

function HeadingEditor({ state, path, title, cost }: { state: MiningCostState; path: string; title: string; cost: HeadingCostBreakdown | undefined }) {
  const f = (k: string) => `${path}.${k}`;
  return (
    <Section title={title} subtitle={cost ? `— ${formatDecimalGrouped(cost.perMetre.total, 0)} US$/m` : undefined}>
      {cost && (
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 mb-2 text-[11px]">
          {([
            ['Consommables', cost.perMetre.consumables],
            ['Engins', cost.perMetre.equipment],
            ['Énergie', cost.perMetre.energy],
            ['Allocation', cost.perMetre.allowance],
            ["Main-d'œuvre", cost.perMetre.labour],
            ['Total', cost.perMetre.total],
          ] as const).map(([k, v]) => (
            <div key={k} className="card-sm py-1"><div className="mf-txt4">{k}</div><div className="font-semibold text-amber-300">{formatDecimalGrouped(v, 0)} US$/m</div></div>
          ))}
          <div className="col-span-3 lg:col-span-6 mf-txt4">
            Durées par volée : foration {formatDecimalGrouped(cost.hours.drilling, 2)} h · sautage {formatDecimalGrouped(cost.hours.blasting, 2)} h ·
            soutènement {formatDecimalGrouped(cost.hours.groundSupport, 2)} h · marinage {formatDecimalGrouped(cost.hours.mucking, 2)} h ·
            main-d'œuvre par activité (contrôle) {formatDecimalGrouped(cost.perMetre.labourActivity, 0)} US$/m
          </div>
        </div>
      )}
      <Grid>
        <div>
          <NumField state={state} path={f('widthM')} label="Largeur" unit="m" />
          <NumField state={state} path={f('heightM')} label="Hauteur" unit="m" />
          <NumField state={state} path={f('overbreakFraction')} label="Hors-profil" unit="%" scale={100} />
          <NumField state={state} path={f('advancePerRoundM')} label="Avancement par volée" unit="m" />
          <NumField state={state} path={f('rockSgTpm3')} label="Densité de la roche" unit="t/m³" />
          <NumField state={state} path={f('holesPerRound')} label="Trous par volée" unit="" step="1" />
          <NumField state={state} path={f('reamersPerRound')} label="Trous alésés" unit="" step="1" />
          <NumField state={state} path={f('drilledLengthM')} label="Longueur forée" unit="m" />
          <NumField state={state} path={f('drillSteelUsdPerDrillM')} label="Aciers de foration" unit="US$/m foré" />
          <NumField state={state} path={f('explosiveUsdKg')} label="Explosif chargé" unit="US$/kg" />
          <NumField state={state} path={f('initiationUsdPerHole')} label="Amorçage" unit="US$/trou" />
          <NumField state={state} path={f('boltsPerRound')} label="Boulons par volée" unit="" step="1" />
          <NumField state={state} path={f('boltUsd')} label="Boulon (moyen)" unit="US$" />
          <NumField state={state} path={f('meshSheetsPerRound')} label="Treillis par volée" unit="" step="1" />
          <NumField state={state} path={f('meshSheetUsd')} label="Treillis (moyen)" unit="US$" />
        </div>
        <div>
          <NumField state={state} path={f('lhdTph')} label="Chargeuse-navette" unit="t/h" />
          <NumField state={state} path={f('jumboUsdH')} label="Jumbo (pièces, pneus)" unit="US$/h" />
          <NumField state={state} path={f('chargerUsdH')} label="Chargeur d'explosifs" unit="US$/h" />
          <NumField state={state} path={f('bolterUsdH')} label="Boulonneuse" unit="US$/h" />
          <NumField state={state} path={f('lhdUsdH')} label="Chargeuse-navette" unit="US$/h" />
          <NumField state={state} path={f('servicesUsdPerM.consumables')} label="Services — consommables" unit="US$/m" />
          <NumField state={state} path={f('shotcrete.allocation')} label="Béton projeté — part des volées" unit="%" scale={100} />
          <NumField state={state} path={f('allowancePct')} label="Allocation" unit="%" />
          <SelectField state={state} path={f('labourBasis')} label="Main-d'œuvre directe" options={[
            { value: 'unit', label: 'Coût unitaire (base OPEX publiée)' },
            { value: 'activity', label: 'Par activité (poste entier)' },
          ]} />
          <NumField state={state} path={f('directLabourUsdPerM')} label="Main-d'œuvre directe unitaire" unit="US$/m" />
        </div>
      </Grid>
    </Section>
  );
}

function UndergroundEditor({ state }: { state: MiningCostState }) {
  const r = state.result?.method === 'underground' ? state.result : null;
  return (
    <div className="space-y-2">
      <ScheduleSection state={state} />
      <Section title="Calendrier & disponibilité" subtitle="— postes, temps opératoire, heures payées">
        <Grid>
          <div>
            <NumField state={state} path="underground.shiftsPerDay" label="Postes par jour" unit="" step="1" />
            <NumField state={state} path="underground.hoursPerShift" label="Heures par poste" unit="h" />
            <NumField state={state} path="underground.nonOperatingHPerShift" label="Temps non opératoire" unit="h/poste" />
          </div>
          <div>
            <NumField state={state} path="underground.equipmentAvailability" label="Disponibilité des engins" unit="%" scale={100} />
            <NumField state={state} path="underground.operatingDaysPerYear" label="Jours d'exploitation" unit="j/an" step="1" />
            <NumField state={state} path="underground.paidHoursPerYear" label="Heures payées par ETP" unit="h/an" />
          </div>
        </Grid>
      </Section>
      <Section title="Intensités physiques" subtitle="— développement et remblai par kt de minerai (plan Eastwood)">
        <Grid>
          <div>
            <NumField state={state} path="underground.devOreFraction" label="Minerai issu du développement" unit="%" scale={100} />
            <NumField state={state} path="underground.opLateralMPerKt" label="Latéral d'exploitation" unit="m/kt" />
            <NumField state={state} path="underground.capLateralMPerKtProduction" label="Latéral capital (production)" unit="m/kt" />
            <NumField state={state} path="underground.preProductionCapLateralM" label="Latéral capital (pré-production)" unit="m" />
          </div>
          <div>
            <NumField state={state} path="underground.verticalMPerKtProduction" label="Vertical (production)" unit="m/kt" />
            <NumField state={state} path="underground.preProductionVerticalM" label="Vertical (pré-production)" unit="m" />
            <NumField state={state} path="underground.verticalUsdPerM" label="Coût du développement vertical" unit="US$/m" />
            <NumField state={state} path="underground.backfillTPerStopeT" label="Remblai" unit="t/t abattue" />
          </div>
        </Grid>
      </Section>
      <HeadingEditor state={state} path="underground.capitalHeading" title="Galerie de développement capital" cost={r?.capitalHeadingCost} />
      <HeadingEditor state={state} path="underground.operatingHeading" title="Galerie de développement d'exploitation" cost={r?.operatingHeadingCost} />
      <Section title="Abattage" subtitle={r ? `— ${formatDecimalGrouped(r.stopeUnitCostUsdT, 2)} US$/t abattue (moyenne pondérée)` : undefined}>
        <ArrayTable<StopeMethod & Record<string, unknown>>
          state={state} path="underground.stopes"
          rowKey={x => x.id}
          columns={[
            { key: 'label', label: 'Méthode', type: 'text', width: 'w-56' },
            { key: 'share', label: 'Part %', scale: 100 },
            { key: 'suppliesUsdT', label: 'Consommables $/t' },
            { key: 'equipmentUsdT', label: 'Engins $/t' },
            { key: 'energyUsdT', label: 'Énergie $/t' },
            { key: 'labourUsdT', label: "Main-d'œuvre $/t" },
          ]}
          newRow={() => ({ id: `stope_${Date.now()}`, label: 'Nouvelle méthode', share: 0, suppliesUsdT: 0, equipmentUsdT: 0, energyUsdT: 0, labourUsdT: 0 })}
        />
      </Section>
      <Section title="Manutention & services" subtitle="— t·km, extraction, roulage, services miniers">
        <Grid>
          <div>
            <NumField state={state} path="underground.oreHaulKm" label="Distance moyenne — minerai" unit="km" />
            <NumField state={state} path="underground.wasteHaulKm" label="Distance moyenne — stérile" unit="km" />
            <NumField state={state} path="underground.truckUsdPerTkm" label="Camionnage" unit="US$/t·km" />
            <NumField state={state} path="underground.truckLabourUsdPerTkm" label="Main-d'œuvre de manutention" unit="US$/t·km" />
            <NumField state={state} path="underground.oreHoistedFraction" label="Minerai extrait par puits" unit="%" scale={100} />
            <NumField state={state} path="underground.wasteHoistedFraction" label="Stérile remonté au jour" unit="%" scale={100} />
          </div>
          <div>
            <NumField state={state} path="underground.hoistingUsdPerT" label="Extraction au puits" unit="US$/t" />
            <NumField state={state} path="underground.surfaceHaulUsdPerT" label="Roulage en surface" unit="US$/t" />
            <NumField state={state} path="underground.mineServicesUsdPerOreT" label="Services miniers" unit="US$/t" />
            <NumField state={state} path="underground.preProductionServicesUsdPerYear" label="Services (pré-production)" unit="US$/an" />
            <NumField state={state} path="underground.definitionDrillingUsdPerOreT" label="Forage de définition" unit="US$/t" />
          </div>
        </Grid>
      </Section>
      <RatesSection state={state} prefix="underground" roles={[
        { key: 'driller', label: 'Foreur (jumbo)' },
        { key: 'blaster', label: 'Boutefeu' },
        { key: 'bolter', label: 'Boulonneur' },
        { key: 'mucker', label: 'Opérateur de chargeuse-navette' },
        { key: 'mechanic', label: 'Mécanicien' },
      ]} />
      <Section title="Flotte mobile" subtitle="— dimensionnée par les heures d'activité ou fixe">
        <ArrayTable<UgFleetItem & Record<string, unknown>>
          state={state} path="underground.fleet"
          rowKey={x => x.id}
          columns={[
            { key: 'label', label: 'Engin', type: 'text', width: 'w-56' },
            { key: 'deliveredPriceUsd', label: 'Prix US$', width: 'w-24' },
            { key: 'lifeHours', label: 'Vie h' },
            { key: 'annualUsageHours', label: 'Usage h/an' },
            { key: 'driver', label: 'Dimensionnement', type: 'select', options: [
              { value: 'fixed', label: 'Quantité fixe' },
              { value: 'jumbo_hours', label: 'Heures de foration' },
              { value: 'bolter_hours', label: 'Heures de soutènement' },
              { value: 'charger_hours', label: 'Heures de sautage' },
              { value: 'dev_lhd_hours', label: 'Heures de marinage' },
              { value: 'stope_tonnes', label: 'Tonnes abattues' },
              { value: 'ore_tkm', label: 't·km de minerai' },
            ] },
            { key: 'fixedQty', label: 'Qté fixe' },
            { key: 'productivityPerHour', label: 'Productivité /h' },
          ]}
          newRow={() => ({ id: `ugeq_${Date.now()}`, label: 'Nouvel engin', deliveredPriceUsd: 0, lifeHours: 0, annualUsageHours: 0, driver: 'fixed', fixedQty: 1, productivityPerHour: 0 })}
        />
      </Section>
      <Section title="Infrastructures fixes" subtitle="— quantités × coûts unitaires, initial ou maintien">
        <ArrayTable<InfrastructureItem & Record<string, unknown>>
          state={state} path="underground.infrastructure"
          rowKey={x => x.id}
          columns={[
            { key: 'label', label: 'Poste', type: 'text', width: 'w-64' },
            { key: 'category', label: 'Catégorie', type: 'text', width: 'w-28' },
            { key: 'qty', label: 'Qté' },
            { key: 'unitCostUsd', label: 'Coût unitaire US$', width: 'w-24' },
            { key: 'timing', label: 'Période', type: 'select', options: [{ value: 'initial', label: 'Initial' }, { value: 'sustaining', label: 'Maintien' }] },
          ]}
          newRow={() => ({ id: `infra_${Date.now()}`, label: 'Nouveau poste', category: 'Divers', qty: 1, unitCostUsd: 0, timing: 'initial' })}
        />
        <div className="mt-2 max-w-md">
          <NumField state={state} path="underground.contingencyPct" label="Contingence (tout le capital)" unit="%" />
        </div>
      </Section>
    </div>
  );
}

export function MiningInputsEditor({ state }: { state: MiningCostState }) {
  if (!state.model) return null;
  return state.model.method === 'underground' ? <UndergroundEditor state={state} /> : <OpenPitEditor state={state} />;
}
