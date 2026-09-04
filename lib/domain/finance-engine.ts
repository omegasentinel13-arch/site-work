export type TransactionType = 'CREDIT' | 'DEBIT';
export type DebitCategory = 'SUPPLIES' | 'SPECIAL_WORKER_TASK';

export interface FinancialTransactionItem {
  id: string;
  siteId: string;
  date: string;
  type: TransactionType;
  debitCategory?: DebitCategory | null;
  amountPaise: number;
  description: string;
  referenceNote?: string | null;
  createdAt: string;
}

export interface FinancialSummary {
  openingBalancePaise: number;
  totalCreditPaise: number;
  suppliesDebitPaise: number;
  specialWorkerTaskDebitPaise: number;
  totalDebitPaise: number;
  netCashFlowPaise: number;
  closingBalancePaise: number;
  transactionCount: number;
}

/**
 * Authoritative financial summary calculation.
 * Computes opening, period credits, categorized debits, and closing balance.
 */
export function calculateFinancialSummary(
  transactions: FinancialTransactionItem[],
  openingBalancePaise = 0
): FinancialSummary {
  let totalCreditPaise = 0;
  let suppliesDebitPaise = 0;
  let specialWorkerTaskDebitPaise = 0;

  for (const tx of transactions) {
    const amt = Math.max(0, Math.floor(tx.amountPaise || 0));
    if (tx.type === 'CREDIT') {
      totalCreditPaise += amt;
    } else if (tx.type === 'DEBIT') {
      if (tx.debitCategory === 'SUPPLIES') {
        suppliesDebitPaise += amt;
      } else if (tx.debitCategory === 'SPECIAL_WORKER_TASK') {
        specialWorkerTaskDebitPaise += amt;
      } else {
        // Default to supplies if unspecified
        suppliesDebitPaise += amt;
      }
    }
  }

  const totalDebitPaise = suppliesDebitPaise + specialWorkerTaskDebitPaise;
  const netCashFlowPaise = totalCreditPaise - totalDebitPaise;
  const closingBalancePaise = openingBalancePaise + netCashFlowPaise;

  return {
    openingBalancePaise,
    totalCreditPaise,
    suppliesDebitPaise,
    specialWorkerTaskDebitPaise,
    totalDebitPaise,
    netCashFlowPaise,
    closingBalancePaise,
    transactionCount: transactions.length,
  };
}
