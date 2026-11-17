'use strict'
// Pins what the two model screens return for the shared process fixture. Steps 3
// and 4 move the scanning behind core/process-scan.js; every Data Sources result
// here must stay identical, and the Cube Map may change only for the settled rules.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const summaryFile = path.join(os.tmpdir(), `process-scan-fixture-summaries-${process.pid}.json`)
process.env.PROCESS_SUMMARIES_FILE = summaryFile

const fixture = require('./fixtures/process-scan')
const { getCubeDataSources, getViewSourceUsage, getProcessFacts, listProcessSummaries, invalidate } = require('../core/cube-data-sources')
const { buildCubeMapModel } = require('../core/cubemap')

const plain = value => JSON.parse(JSON.stringify(value))

test.after(() => { try { fs.unlinkSync(summaryFile) } catch { /* best effort */ } })

const expectedSources = {
  'Target': {'cube':'Target','dims':['Period','Measure'],'ruleReads':{'calc':[],'calcEvidence':{},'feeders':[],'feederEvidence':{}},'writers':[{'process':'P literal','kinds':['write'],'measures':['Amount'],'callers':[],'evidence':[{'kind':'write','measure':'Amount','code':"CellPutN(1, 'Target', 'Jan', 'Amount');"}],'header':'','source':'None','parameters':[],'codeHash':'907314ed7c985a7b','reads':[],'calledBy':[],'summary':null,'summaryAt':null,'summarySource':null,'summaryModel':null,'summaryStale':false},{'process':'P variable','kinds':['write'],'measures':['Amount'],'callers':[],'evidence':[{'kind':'write','measure':'Amount','code':"CellPutN(2, cTarget, 'Jan', 'Amount');"}],'header':'','source':'None','parameters':[],'codeHash':'4282d767f21d6d9d','reads':[],'calledBy':[],'summary':null,'summaryAt':null,'summarySource':null,'summaryModel':null,'summaryStale':false},{'process':'P chain','kinds':['write'],'measures':['Amount'],'callers':[],'evidence':[{'kind':'write','measure':'Amount','code':"CellPutN(3, cAlias, 'Jan', 'Amount');"}],'header':'','source':'None','parameters':[],'codeHash':'b453465b877c04bf','reads':[],'calledBy':[],'summary':null,'summaryAt':null,'summarySource':null,'summaryModel':null,'summaryStale':false},{'process':'P param default','kinds':['write'],'measures':['Amount'],'callers':[],'evidence':[{'kind':'write','measure':'Amount','code':"CellPutN(4, pCube, 'Jan', 'Amount');"}],'header':'','source':'None','parameters':['pCube'],'codeHash':'717851d6fea4768c','reads':[],'calledBy':[],'summary':null,'summaryAt':null,'summarySource':null,'summaryModel':null,'summaryStale':false},{'process':'Generic Copy','kinds':['write'],'measures':[],'callers':['P call generic'],'evidence':[{'kind':'write','code':"ExecuteProcess('Generic Copy', 'pCube', 'Target');",'by':'P call generic'}],'header':'','source':'None','parameters':['pCube'],'codeHash':'f6635782e3df55d5','reads':[],'calledBy':['P call generic'],'summary':null,'summaryAt':null,'summarySource':null,'summaryModel':null,'summaryStale':false},{'process':'P clear','kinds':['clear','feeders'],'measures':[],'callers':[],'evidence':[{'kind':'clear','code':"ViewZeroOut('Target', 'v');"},{'kind':'feeders','code':"CubeProcessFeeders('Target');"}],'header':'','source':'None','parameters':[],'codeHash':'3786ee2f37eaffc2','reads':[],'calledBy':[],'summary':null,'summaryAt':null,'summarySource':null,'summaryModel':null,'summaryStale':false}],'readers':[],'copiers':[]},
  'Source': {'cube':'Source','dims':['Period','Measure'],'ruleReads':{'calc':['ReadCube','Source','Missing Cube','O'],'calcEvidence':{'ReadCube':["['Measure'] = N: DB('ReadCube', 'Measure') + DB('Source', 'Measure') + DB('Missing Cube', 'Measure') + DB('O''Brien Sales', 'Measure');"],'Source':["['Measure'] = N: DB('ReadCube', 'Measure') + DB('Source', 'Measure') + DB('Missing Cube', 'Measure') + DB('O''Brien Sales', 'Measure');"],'Missing Cube':["['Measure'] = N: DB('ReadCube', 'Measure') + DB('Source', 'Measure') + DB('Missing Cube', 'Measure') + DB('O''Brien Sales', 'Measure');"],'O':["['Measure'] = N: DB('ReadCube', 'Measure') + DB('Source', 'Measure') + DB('Missing Cube', 'Measure') + DB('O''Brien Sales', 'Measure');"]},'feeders':['FeederCube','Source','O'],'feederEvidence':{'FeederCube':["['Measure'] => DB('FeederCube', 'Measure') + DB('Source', 'Measure') + DB('O''Brien Sales', 'Measure');"],'Source':["['Measure'] => DB('FeederCube', 'Measure') + DB('Source', 'Measure') + DB('O''Brien Sales', 'Measure');"],'O':["['Measure'] => DB('FeederCube', 'Measure') + DB('Source', 'Measure') + DB('O''Brien Sales', 'Measure');"]}},'writers':[{'process':'P clear','kinds':['clear'],'measures':[],'callers':[],'evidence':[{'kind':'clear','code':"CubeClearData('Source');"}],'header':'','source':'None','parameters':[],'codeHash':'3786ee2f37eaffc2','reads':[],'calledBy':[],'summary':null,'summaryAt':null,'summarySource':null,'summaryModel':null,'summaryStale':false}],'readers':[{'process':'P view source','how':['view'],'evidence':[{'kind':'view','code':"Data source: view 'Source View' over 'Source'"}],'header':'','source':'TM1CubeView','parameters':[],'codeHash':'2d27fbdf4e8ca207','reads':['Source'],'calledBy':[],'summary':null,'summaryAt':null,'summarySource':null,'summaryModel':null,'summaryStale':false}],'copiers':[]},
  'Sales 2026': {'cube':'Sales 2026','dims':['Period','Measure'],'ruleReads':{'calc':[],'calcEvidence':{},'feeders':[],'feederEvidence':{}},'writers':[],'readers':[{'process':'P expr read','how':['cellget'],'evidence':[{'kind':'cellget','code':"CellGetN('Sales ' | sYear, 'Jan', 'Amount');"}],'header':'','source':'None','parameters':[],'codeHash':'96b5a9f1458c4206','reads':['Sales 2026'],'calledBy':[],'summary':null,'summaryAt':null,'summarySource':null,'summaryModel':null,'summaryStale':false}],'copiers':[]},
  'Sales 2026, Ltd': {'cube':'Sales 2026, Ltd','dims':['Period','Measure'],'ruleReads':{'calc':[],'calcEvidence':{},'feeders':[],'feederEvidence':{}},'writers':[],'readers':[{'process':'P comma read','how':['cellget'],'evidence':[{'kind':'cellget','code':"CellGetN('Sales ' | sYear | ', Ltd', 'Jan', 'Amount');"}],'header':'','source':'None','parameters':[],'codeHash':'95de9963bcfec650','reads':['Sales 2026, Ltd'],'calledBy':[],'summary':null,'summaryAt':null,'summarySource':null,'summaryModel':null,'summaryStale':false}],'copiers':[]},
  'Versioned': {'cube':'Versioned','dims':['Period','Version','Measure'],'ruleReads':{'calc':[],'calcEvidence':{},'feeders':[],'feederEvidence':{}},'writers':[],'readers':[],'copiers':['P snapshot']},
  'Unversioned': {'cube':'Unversioned','dims':['Period','Measure'],'ruleReads':{'calc':[],'calcEvidence':{},'feeders':[],'feederEvidence':{}},'writers':[],'readers':[],'copiers':[]},
  "O'Brien Sales": {'cube':"O'Brien Sales",'dims':['Period','Measure'],'ruleReads':{'calc':[],'calcEvidence':{},'feeders':[],'feederEvidence':{}},'writers':[],'readers':[],'copiers':[]},
}

const expectedCubes = {
  'Target': {'dims':['Period','Measure'],'hasRules':false,'ruleCalcRefs':[],'ruleFeederRefs':[],'ruleLoc':0,'tiWriters':['P literal','P variable','P chain','P param default','Generic Copy','P clear'],'tiReaders':[]},
  'Source': {'dims':['Period','Measure'],'hasRules':true,'ruleCalcRefs':['ReadCube'],'ruleFeederRefs':['FeederCube'],'ruleLoc':1,'tiWriters':['P clear'],'tiReaders':['P view source']},
  'ReadCube': {'dims':['Period','Measure'],'hasRules':false,'ruleCalcRefs':[],'ruleFeederRefs':[],'ruleLoc':0,'tiWriters':[],'tiReaders':[]},
  'FeederCube': {'dims':['Period','Measure'],'hasRules':false,'ruleCalcRefs':[],'ruleFeederRefs':[],'ruleLoc':0,'tiWriters':[],'tiReaders':[]},
  'Sales 2026': {'dims':['Period','Measure'],'hasRules':false,'ruleCalcRefs':[],'ruleFeederRefs':[],'ruleLoc':0,'tiWriters':[],'tiReaders':['P expr read']},
  'Sales 2026, Ltd': {'dims':['Period','Measure'],'hasRules':false,'ruleCalcRefs':[],'ruleFeederRefs':[],'ruleLoc':0,'tiWriters':[],'tiReaders':['P comma read']},
  'Versioned': {'dims':['Period','Version','Measure'],'hasRules':false,'ruleCalcRefs':[],'ruleFeederRefs':[],'ruleLoc':0,'tiWriters':[],'tiReaders':[]},
  'Unversioned': {'dims':['Period','Measure'],'hasRules':false,'ruleCalcRefs':[],'ruleFeederRefs':[],'ruleLoc':0,'tiWriters':[],'tiReaders':[]},
  "O'Brien Sales": {'dims':['Period','Measure'],'hasRules':false,'ruleCalcRefs':[],'ruleFeederRefs':[],'ruleLoc':0,'tiWriters':[],'tiReaders':[]},
}

const expectedProcesses = {
  'P literal': {'reads':[],'writes':['Target'],'calls':[],'dimWrites':[],'steps':[{'kind':'write','target':'Target','pos':0,'measures':['Amount']}]},
  'P variable': {'reads':[],'writes':['Target'],'calls':[],'dimWrites':[],'steps':[{'kind':'write','target':'Target','pos':20,'measures':['Amount']}]},
  'P chain': {'reads':[],'writes':['Target'],'calls':[],'dimWrites':[],'steps':[{'kind':'write','target':'Target','pos':34,'measures':['Amount']}]},
  'P param default': {'reads':[],'writes':['Target'],'calls':[],'dimWrites':[],'steps':[{'kind':'write','target':'Target','pos':0,'measures':['Amount']}]},
  'P view source': {'reads':['Source'],'writes':[],'calls':[],'dimWrites':[],'steps':[{'kind':'read','target':'Source','pos':-1}]},
  'P call generic': {'reads':[],'writes':[],'calls':['Generic Copy'],'dimWrites':[],'steps':[{'kind':'call','target':'Generic Copy','pos':0}]},
  'Generic Copy': {'reads':[],'writes':['Target'],'calls':[],'dimWrites':[],'steps':[{'kind':'write','target':'Target','pos':null}]},
  'P snapshot': {'reads':[],'writes':[],'calls':['}IDE.Version.Copy'],'dimWrites':[],'steps':[{'kind':'call','target':'}IDE.Version.Copy','pos':0}]},
  'P dim': {'reads':[],'writes':[],'calls':[],'dimWrites':['Dim'],'steps':[{'kind':'dimwrite','target':'Dim','pos':0}]},
  'P clear': {'reads':[],'writes':['Target','Source'],'calls':[],'dimWrites':[],'steps':[{'kind':'write','target':'Target','pos':0},{'kind':'write','target':'Source','pos':58}]},
  'P expr read': {'reads':['Sales 2026'],'writes':[],'calls':[],'dimWrites':[],'steps':[{'kind':'read','target':'Sales 2026','pos':16}]},
  'P comma read': {'reads':['Sales 2026, Ltd'],'writes':[],'calls':[],'dimWrites':[],'steps':[{'kind':'read','target':'Sales 2026, Ltd','pos':16}]},
}

const expectedDims = {'Dim':{'writers':['P dim'],'cubes':[]}}
const expectedProcessCallers = {'Generic Copy':['P call generic'],'}IDE.Version.Copy':['P snapshot']}

const expectedView = {'cube':'Source','view':'Source View','processes':[{'process':'P view source'}]}
const expectedViewMiss = {'cube':'Source','view':'No Such View','processes':[]}
const expectedFacts = {
  'P literal': {'name':'P literal','header':'','source':'None','parameters':[],'calledBy':[],'hash':'907314ed7c985a7b','writes':[{'cube':'Target','measures':['Amount'],'kinds':['write']}],'reads':[],'copies':[]},
  'Generic Copy': {'name':'Generic Copy','header':'','source':'None','parameters':['pCube'],'calledBy':['P call generic'],'hash':'f6635782e3df55d5','writes':[{'cube':'Target','measures':[],'kinds':['write']}],'reads':[],'copies':[]},
}
const expectedSummaries = [
  {'process':'Generic Copy','header':'','parameters':['pCube'],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P call generic','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P chain','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P clear','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P comma read','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P dim','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P expr read','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P literal','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P missing write','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P obrien','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P param default','header':'','parameters':['pCube'],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P self','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P snapshot','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P variable','header':'','parameters':[],'source':'None','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
  {'process':'P view source','header':'','parameters':[],'source':'TM1CubeView','summary':null,'at':null,'sourceKind':null,'model':null,'stale':false},
]

test('today: Data Sources facts for every fixture cube', async () => {
  invalidate()
  for (const [cube, expected] of Object.entries(expectedSources)) {
    assert.deepEqual(plain(await getCubeDataSources(fixture.makeClient(), 'fixture', cube)), expected, cube)
  }
})

test('today: view usage, process facts and the summary list', async () => {
  invalidate()
  assert.deepEqual(plain(await getViewSourceUsage(fixture.makeClient(), 'fixture', 'Source', 'Source View')), expectedView)
  assert.deepEqual(plain(await getViewSourceUsage(fixture.makeClient(), 'fixture', 'Source', 'No Such View')), expectedViewMiss)
  assert.deepEqual(plain(await getProcessFacts(fixture.makeClient(), 'fixture', 'P literal')), expectedFacts['P literal'])
  assert.deepEqual(plain(await getProcessFacts(fixture.makeClient(), 'fixture', 'Generic Copy')), expectedFacts['Generic Copy'])
  assert.deepEqual(plain(await listProcessSummaries(fixture.makeClient(), 'fixture')), expectedSummaries)
})

test('today: Cube Map edges, steps and dimensions', async () => {
  const model = plain(await buildCubeMapModel(fixture.makeClient()))
  assert.deepEqual(model.cubes, expectedCubes)
  assert.deepEqual(model.processCallers, expectedProcessCallers)
  assert.deepEqual(model.processes, expectedProcesses)
  assert.deepEqual(model.dims, expectedDims)
  assert.deepEqual(model.chores, [])
})

test('today: control processes are opt-in', async () => {
  const normal = plain(await buildCubeMapModel(fixture.makeClient()))
  const withControl = plain(await buildCubeMapModel(fixture.makeClient(), { includeControl: true }))
  assert.deepEqual(normal.cubes.Target.tiWriters, expectedCubes.Target.tiWriters)
  assert.deepEqual(withControl.cubes.Target.tiWriters, [...expectedCubes.Target.tiWriters, '}Control'])
  assert.deepEqual(withControl.processes['}Control'], {'reads':[],'writes':['Target'],'calls':[],'dimWrites':[],'steps':[{'kind':'write','target':'Target','pos':0,'measures':['Amount']}]})
})
