import { useState } from 'react'
import HierarchyGrid from '@/components/HierarchyGrid'
import { useStore } from '@/store'

// ── Shared row hierarchies ────────────────────────────────────────────────────

const ORG = {
    name: 'Organisation',
    nodes: {
        'Total Company': { id: 'Total Company', label: 'Total Company', level: 2, isLeaf: false, children: ['NOAM', 'EMEA'] },
        'NOAM':   { id: 'NOAM',   label: 'NOAM',   level: 1, isLeaf: false, children: ['US', 'Canada'] },
        'EMEA':   { id: 'EMEA',   label: 'EMEA',   level: 1, isLeaf: false, children: ['UK', 'Germany'] },
        'US':     { id: 'US',     label: 'US',     level: 0, isLeaf: true, children: [] },
        'Canada': { id: 'Canada', label: 'Canada', level: 0, isLeaf: true, children: [] },
        'UK':     { id: 'UK',     label: 'UK',     level: 0, isLeaf: true, children: [] },
        'Germany':{ id: 'Germany',label: 'Germany',level: 0, isLeaf: true, children: [] },
    },
    roots: ['Total Company'], maxLevel: 2,
}

const PRODUCT = {
    name: 'Product',
    nodes: {
        'All Products': { id: 'All Products', label: 'All Products', level: 1, isLeaf: false, children: ['Hardware', 'Software'] },
        'Hardware': { id: 'Hardware', label: 'Hardware', level: 0, isLeaf: true, children: [] },
        'Software': { id: 'Software', label: 'Software', level: 0, isLeaf: true, children: [] },
    },
    roots: ['All Products'], maxLevel: 1,
}

// ── Test 1: 2-dim ROW × 1-dim COL ────────────────────────────────────────────

const MONTH = {
    name: 'Month',
    nodes: {
        'Full Year': { id: 'Full Year', label: 'Full Year', level: 2, isLeaf: false, children: ['Q1', 'Q2'] },
        'Q1': { id: 'Q1', label: 'Q1', level: 1, isLeaf: false, children: ['Jan', 'Feb', 'Mar'] },
        'Q2': { id: 'Q2', label: 'Q2', level: 1, isLeaf: false, children: ['Apr', 'May', 'Jun'] },
        'Jan': { id: 'Jan', label: 'Jan', level: 0, isLeaf: true, children: [] },
        'Feb': { id: 'Feb', label: 'Feb', level: 0, isLeaf: true, children: [] },
        'Mar': { id: 'Mar', label: 'Mar', level: 0, isLeaf: true, children: [] },
        'Apr': { id: 'Apr', label: 'Apr', level: 0, isLeaf: true, children: [] },
        'May': { id: 'May', label: 'May', level: 0, isLeaf: true, children: [] },
        'Jun': { id: 'Jun', label: 'Jun', level: 0, isLeaf: true, children: [] },
    },
    roots: ['Full Year'], maxLevel: 2,
}

const COLS_1 = [
    { id: 'c_fy',  label: 'Full Year', members: ['Full Year'] },
    { id: 'c_q1',  label: 'Q1',  members: ['Q1'] },
    { id: 'c_jan', label: 'Jan', members: ['Jan'] },
    { id: 'c_feb', label: 'Feb', members: ['Feb'] },
    { id: 'c_mar', label: 'Mar', members: ['Mar'] },
    { id: 'c_q2',  label: 'Q2',  members: ['Q2'] },
    { id: 'c_apr', label: 'Apr', members: ['Apr'] },
    { id: 'c_may', label: 'May', members: ['May'] },
    { id: 'c_jun', label: 'Jun', members: ['Jun'] },
]

function seed(fy) {
    const q1 = Math.round(fy * 0.5), q2 = fy - q1
    return {
        c_fy: fy, c_q1: q1, c_jan: Math.round(q1*0.31), c_feb: Math.round(q1*0.33), c_mar: q1-Math.round(q1*0.31)-Math.round(q1*0.33),
        c_q2: q2, c_apr: Math.round(q2*0.31), c_may: Math.round(q2*0.33), c_jun: q2-Math.round(q2*0.31)-Math.round(q2*0.33),
    }
}

const DATA_1 = {
    'US::All Products': seed(290200), 'US::Hardware': seed(174120), 'US::Software': seed(116080),
    'Canada::All Products': seed(117800), 'Canada::Hardware': seed(70680), 'Canada::Software': seed(47120),
    'UK::All Products': seed(178400), 'UK::Hardware': seed(107040), 'UK::Software': seed(71360),
    'Germany::All Products': seed(142800), 'Germany::Hardware': seed(85680), 'Germany::Software': seed(57120),
    'NOAM::All Products': seed(408000), 'NOAM::Hardware': seed(244800), 'NOAM::Software': seed(163200),
    'EMEA::All Products': seed(321200), 'EMEA::Hardware': seed(192720), 'EMEA::Software': seed(128480),
    'Total Company::All Products': seed(729200), 'Total Company::Hardware': seed(437520), 'Total Company::Software': seed(291680),
}

// ── Test 2: 1-dim ROW × 2-dim COL ────────────────────────────────────────────

const SCENARIO = {
    name: 'Scenario',
    nodes: {
        'All Scenarios': { id: 'All Scenarios', label: 'All Scenarios', level: 1, isLeaf: false, children: ['Actual', 'Budget'] },
        'Actual': { id: 'Actual', label: 'Actual', level: 0, isLeaf: true, children: [] },
        'Budget': { id: 'Budget', label: 'Budget', level: 0, isLeaf: true, children: [] },
    },
    roots: ['All Scenarios'], maxLevel: 1,
}

// Quarter hierarchy — no month breakdown to keep mock data manageable
const QUARTER = {
    name: 'Quarter',
    nodes: {
        'Full Year': { id: 'Full Year', label: 'Full Year', level: 1, isLeaf: false, children: ['Q1', 'Q2', 'Q3', 'Q4'] },
        'Q1': { id: 'Q1', label: 'Q1', level: 0, isLeaf: true, children: [] },
        'Q2': { id: 'Q2', label: 'Q2', level: 0, isLeaf: true, children: [] },
        'Q3': { id: 'Q3', label: 'Q3', level: 0, isLeaf: true, children: [] },
        'Q4': { id: 'Q4', label: 'Q4', level: 0, isLeaf: true, children: [] },
    },
    roots: ['Full Year'], maxLevel: 1,
}

// Columns: Scenario × Quarter tuples
const SCENARIOS = ['All Scenarios', 'Actual', 'Budget']
const QUARTERS  = ['Full Year', 'Q1', 'Q2', 'Q3', 'Q4']
const COLS_2    = SCENARIOS.flatMap(s => QUARTERS.map(q => ({
    id: `c_${s}_${q}`.replace(/\s/g, '_'),
    label: `${s} / ${q}`,
    members: [s, q],
})))

const ORGS = ['Total Company', 'NOAM', 'EMEA', 'US', 'Canada', 'UK', 'Germany']
const DATA_2 = Object.fromEntries(ORGS.map(org => [
    org,
    Object.fromEntries(COLS_2.map(col => {
        const base = { 'Total Company': 729200, NOAM: 408000, EMEA: 321200, US: 290200, Canada: 117800, UK: 178400, Germany: 142800 }[org] ?? 100000
        const qFactor = { 'Full Year': 1, Q1: 0.25, Q2: 0.25, Q3: 0.25, Q4: 0.25 }[col.members[1]] ?? 0.25
        const sFactor = { 'All Scenarios': 1, Actual: 0.6, Budget: 0.4 }[col.members[0]] ?? 1
        return [col.id, Math.round(base * qFactor * sFactor)]
    }))
]))

// ── Component ─────────────────────────────────────────────────────────────────

const TESTS = [
    { label: '2-dim ROW × 1-dim COL', id: 'row2' },
    { label: '1-dim ROW × 2-dim COL', id: 'col2' },
]

export default function HierarchyGridTest() {
    const { dark } = useStore()
    const [active, setActive] = useState('row2')

    return (
        <div className="flex flex-col h-full">
            <div className="px-3 py-1.5 border-b border-border bg-muted/20 shrink-0 flex items-center gap-3">
                <span className="text-xs text-muted-foreground font-mono">HierarchyGrid test</span>
                <div className="flex items-center gap-0.5">
                    {TESTS.map(t => (
                        <button key={t.id} onClick={() => setActive(t.id)}
                            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${active === t.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
                        >{t.label}</button>
                    ))}
                </div>
            </div>
            <div className="flex-1 min-h-0">
                {active === 'row2' && (
                    <HierarchyGrid
                        hierarchies={[ORG, PRODUCT]}
                        columnHierarchies={[MONTH]}
                        columns={COLS_1}
                        data={DATA_1}
                        dark={dark}
                        keepMode="parent"
                    />
                )}
                {active === 'col2' && (
                    <HierarchyGrid
                        hierarchies={[ORG]}
                        columnHierarchies={[SCENARIO, QUARTER]}
                        columns={COLS_2}
                        data={DATA_2}
                        dark={dark}
                        keepMode="parent"
                    />
                )}
            </div>
        </div>
    )
}
