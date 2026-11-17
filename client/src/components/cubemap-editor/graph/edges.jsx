import { getBezierPath, BaseEdge } from '@xyflow/react'

export function RuleCalcEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: selected ? '#fbbf24' : '#b45309', strokeWidth: selected ? 2.5 : 1.5, opacity: 0.85 }} markerEnd={`url(#arrowCalc${selected ? 'Sel' : ''})`} />
}

export function RuleFeederEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#475569', strokeWidth: 1.5, strokeDasharray: '5 4', opacity: 0.6 }} markerEnd="url(#arrowFeeder)" />
}

export function ProcessWriteEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#10b981', strokeWidth: 1.5, opacity: 0.8 }} markerEnd="url(#arrowWrite)" />
}

export function ProcessReadEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#0ea5e9', strokeWidth: 1.5, strokeDasharray: '6 4', opacity: 0.7 }} markerEnd="url(#arrowRead)" />
}

export function ProcessDimWriteEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#8b5cf6', strokeWidth: 1.5, opacity: 0.8 }} markerEnd="url(#arrowDim)" />
}

export function DimUsedByEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#8b5cf6', strokeWidth: 1, strokeDasharray: '2 4', opacity: 0.5 }} markerEnd="url(#arrowDim)" />
}

export function ProcessCallEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) {
  const [p] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={p} style={{ stroke: '#10b981', strokeWidth: 1.5, strokeDasharray: '3 3', opacity: 0.55 }} markerEnd="url(#arrowCall)" />
}
