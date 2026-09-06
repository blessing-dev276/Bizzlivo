import type { FinanceCharge, FinanceOrder, FinanceOrderStatus, WithdrawalStatus } from '../../types/database'
import {
  CHARGE_TYPE_LABEL,
  ORDER_STATUS_LABEL,
  WITHDRAWAL_STATUS_LABEL,
  money,
  previewCredit,
} from '../../lib/finance'

const ORDER_TINT: Record<FinanceOrderStatus, string> = {
  order_received: 'var(--text-dim)',
  pending_settlement: 'var(--tint-events)',
  settled: 'var(--tint-primary)',
  available: 'var(--tint-ok)',
  partially_paid: 'var(--tint-events)',
  paid: 'var(--tint-ok)',
  cancelled: 'var(--tint-attn)',
}
const WD_TINT: Record<WithdrawalStatus, string> = {
  requested: 'var(--tint-events)',
  approved: 'var(--tint-primary)',
  processing: 'var(--tint-primary)',
  paid: 'var(--tint-ok)',
  rejected: 'var(--tint-attn)',
  cancelled: 'var(--text-dim)',
}

export function OrderStatusPill({ status }: { status: FinanceOrderStatus }) {
  return (
    <span className="status-pill" style={{ color: ORDER_TINT[status], border: `1px solid ${ORDER_TINT[status]}` }}>
      {ORDER_STATUS_LABEL[status]}
    </span>
  )
}

export function WithdrawalStatusPill({ status }: { status: WithdrawalStatus }) {
  return (
    <span className="status-pill" style={{ color: WD_TINT[status], border: `1px solid ${WD_TINT[status]}` }}>
      {WITHDRAWAL_STATUS_LABEL[status]}
    </span>
  )
}

/** The full ORDER → AVAILABLE breakdown shown to members and admins. */
export function OrderBreakdown({ order, charges }: { order: FinanceOrder; charges: FinanceCharge[] }) {
  const live = charges.filter((c) => !c.voided)
  const preview = previewCredit(order, charges)
  return (
    <div className="fin-breakdown">
      <Row label="Gross order" value={money(order.gross_amount, order.currency)} />
      {order.settled_amount != null && (
        <>
          <Row label="Platform deduction" value={`− ${money(order.platform_deduction ?? 0, order.currency)}`} dim />
          <Row label="Net platform settlement" value={money(order.settled_amount, order.settlement_currency ?? order.currency)} strong />
          {order.settled_on && <Row label="Settlement date" value={new Date(order.settled_on).toLocaleDateString()} dim />}
        </>
      )}
      {order.converted && (
        <>
          <Row label="Converted" value="Yes" />
          <Row label="Exchange rate" value={`1 ${order.from_currency} = ${order.exchange_rate} ${order.to_currency}`} dim />
          <Row label="Converted amount" value={money(order.converted_amount ?? 0, order.to_currency ?? '')} strong />
          {order.conversion_date && <Row label="Conversion date" value={new Date(order.conversion_date).toLocaleDateString()} dim />}
        </>
      )}
      {live.length > 0 && (
        <div className="fin-charges">
          {live.map((c) => (
            <Row key={c.id} label={CHARGE_TYPE_LABEL[c.charge_type] ?? c.charge_type} value={`− ${money(c.amount, c.currency)}`} dim />
          ))}
        </div>
      )}
      {preview && (
        <Row
          label={order.credited_at ? 'Final available amount' : 'Projected available'}
          value={money(order.available_amount ?? preview.final, order.available_currency ?? preview.baseCurrency)}
          big
        />
      )}
      {preview?.currencyMismatch && (
        <p className="form-error" style={{ marginTop: 8 }}>
          Some charges are in a different currency than the credit ({preview.baseCurrency}) and are not included.
        </p>
      )}
    </div>
  )
}

function Row({ label, value, dim, strong, big }: { label: string; value: string; dim?: boolean; strong?: boolean; big?: boolean }) {
  return (
    <div className={`fin-row ${big ? 'fin-row-total' : ''}`}>
      <span className={dim ? 'md-muted' : undefined}>{label}</span>
      <span style={{ fontWeight: strong || big ? 700 : 500, fontSize: big ? 16 : undefined }}>{value}</span>
    </div>
  )
}
