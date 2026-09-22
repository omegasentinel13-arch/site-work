'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, 
  ShieldAlert, 
  AlertTriangle, 
  CheckCircle2, 
  Database, 
  ArrowRight, 
  ArrowLeft, 
  Loader2, 
  RotateCcw,
  Layers,
  Users,
  Building2,
  Lock
} from 'lucide-react';
import { clsx } from 'clsx';
import { RestorePlan, ConflictItem, RecordDiffItem } from '@/lib/backup/types';

interface RestoreModalProps {
  backupId?: string | null;
  uploadedFile?: File | null;
  onClose: () => void;
  onRestoreComplete: () => void;
}

export function RestoreModal({ backupId, uploadedFile, onClose, onRestoreComplete }: RestoreModalProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    success: boolean;
    operationId: string;
    preRestoreBackupPath: string;
    recordCounts: Record<string, number>;
    message: string;
  } | null>(null);

  // 1. Fetch Restore Simulation & Diff Plan on mount
  useEffect(() => {
    async function loadPlan() {
      try {
        setLoading(true);
        setError(null);

        let res: Response;
        if (uploadedFile) {
          const formData = new FormData();
          formData.append('file', uploadedFile);
          res = await fetch('/api/backup/restore/simulate', {
            method: 'POST',
            body: formData,
          });
        } else if (backupId) {
          res = await fetch('/api/backup/restore/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ backupId }),
          });
        } else {
          throw new Error('No backup specified for restore.');
        }

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to simulate restoration plan.');
        }

        setPlan(data.plan);
      } catch (err: any) {
        setError(err.message || 'Error preparing restoration plan.');
      } finally {
        setLoading(false);
      }
    }

    loadPlan();
  }, [backupId, uploadedFile]);

  // Handle restoration execution
  const handleExecuteRestore = async () => {
    if (confirmationInput !== 'RESTORE CONFIRM') {
      setError('You must enter "RESTORE CONFIRM" in exact uppercase.');
      return;
    }

    try {
      setStep(5);
      setExecuting(true);
      setError(null);

      let res: Response;
      if (uploadedFile) {
        const formData = new FormData();
        formData.append('file', uploadedFile);
        formData.append('confirmationPhrase', confirmationInput);
        res = await fetch('/api/backup/restore/execute', {
          method: 'POST',
          body: formData,
        });
      } else {
        res = await fetch('/api/backup/restore/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            backupId,
            confirmationPhrase: confirmationInput,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Restoration failed.');
      }

      setExecutionResult(data);
      onRestoreComplete();
    } catch (err: any) {
      setError(err.message || 'Restoration encountered a critical error.');
    } finally {
      setExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-150">
        
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-200 dark:border-[#3A3D42] flex items-center justify-between bg-slate-50 dark:bg-[#202225] rounded-t-2xl">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-black uppercase text-slate-900 dark:text-[#F2F3F5]">
                Controlled Disaster Recovery Restoration
              </h2>
              <span className="text-[10px] text-slate-500 dark:text-[#949BA4] font-medium">
                Step {step} of 5: {step === 1 ? 'Verification' : step === 2 ? 'Invariants' : step === 3 ? 'Record Diff' : step === 4 ? 'Confirmation' : 'Execution'}
              </span>
            </div>
          </div>
          {!executing && (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-slate-900 dark:text-[#1ED760]" />
              <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
                Running Sandbox Verification &amp; Generating Simulation Diff...
              </div>
              <div className="text-[10px] text-slate-400">
                Verifying SQLite schema, foreign key constraints, and record counts.
              </div>
            </div>
          )}

          {error && step !== 5 && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-600 rounded-xl text-xs text-rose-800 dark:text-rose-200 flex items-start space-x-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Error:</span> {error}
              </div>
            </div>
          )}

          {!loading && plan && (
            <>
              {/* Step 1: Deep Verification Overview */}
              {step === 1 && (
                <div className="space-y-3 text-xs">
                  <div className="p-3.5 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-[#3A3D42] rounded-xl space-y-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4]">
                      Backup Snapshot Details
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                      <div><span className="text-slate-400">ID:</span> <span className="font-bold">{plan.backupId}</span></div>
                      <div><span className="text-slate-400">Timestamp:</span> <span className="font-bold">{new Date(plan.backupTimestamp).toLocaleString()}</span></div>
                      <div><span className="text-slate-400">Scope:</span> <span className="font-bold">{plan.scope}</span></div>
                      <div>
                        <span className="text-slate-400">Restorable:</span>{' '}
                        <span className={clsx('font-bold', plan.restorableAsDatabase ? 'text-emerald-600' : 'text-rose-600')}>
                          {plan.restorableAsDatabase ? 'YES (Database Snapshot)' : 'NO (Logical Only)'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {!plan.restorableAsDatabase && (
                    <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-600 rounded-xl text-rose-800 dark:text-rose-200 space-y-1">
                      <div className="font-bold flex items-center space-x-1.5">
                        <ShieldAlert className="w-4 h-4" />
                        <span>Restoration Invariant Violation</span>
                      </div>
                      <p className="text-[11px]">
                        This backup is not restorable as a database. Only SYSTEM + ALL_DATA archives containing a full standalone SQLite binary snapshot can replace active database state.
                      </p>
                    </div>
                  )}

                  {plan.hasBlockingConflicts && (
                    <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-600 rounded-xl text-rose-800 dark:text-rose-200 space-y-1">
                      <div className="font-bold flex items-center space-x-1.5">
                        <AlertTriangle className="w-4 h-4" />
                        <span>Blocking Validation Errors</span>
                      </div>
                      <ul className="list-disc pl-4 text-[11px] space-y-0.5">
                        {plan.conflicts.filter(c => c.severity === 'BLOCKING').map((c, i) => (
                          <li key={i}>{c.title}: {c.description}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {plan.canExecuteRestore && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500/50 rounded-xl text-emerald-800 dark:text-emerald-300 flex items-center space-x-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>Integrity &amp; Referential Constraints Verified in Sandbox.</span>
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Invariants & Conflict Analysis */}
              {step === 2 && (
                <div className="space-y-3 text-xs">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Pre-Restore Invariant &amp; Safety Checks:
                  </div>

                  <div className="space-y-2">
                    <div className="p-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-[#3A3D42] rounded-xl flex items-start space-x-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-slate-900 dark:text-[#F2F3F5]">Mandatory Safety Backup</div>
                        <div className="text-[11px] text-slate-500">
                          The system will automatically snapshot the active database immediately before swapping files.
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-[#3A3D42] rounded-xl flex items-start space-x-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-slate-900 dark:text-[#F2F3F5]">Durable Sidecar Continuity</div>
                        <div className="text-[11px] text-slate-500">
                          Audit history of this restoration will be durably written to the external Recovery Journal sidecar.
                        </div>
                      </div>
                    </div>

                    {plan.conflicts.length > 0 ? (
                      plan.conflicts.map((c, i) => (
                        <div
                          key={i}
                          className={clsx(
                            'p-3 rounded-xl border flex items-start space-x-2.5',
                            c.severity === 'BLOCKING'
                              ? 'bg-rose-50 border-rose-300 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
                              : 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200'
                          )}
                        >
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <div>
                            <div className="font-bold">{c.title} ({c.severity})</div>
                            <div className="text-[11px]">{c.description}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500/50 rounded-xl text-emerald-800 dark:text-emerald-300 flex items-center space-x-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>No conflicts or site registry mismatches detected.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Record Diff Simulation */}
              {step === 3 && (
                <div className="space-y-3 text-xs">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Calculated Record Count Diff (Active DB vs Restored DB):
                  </div>

                  <div className="border border-slate-200 dark:border-[#3A3D42] rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 dark:bg-[#202225] border-b border-slate-200 dark:border-[#3A3D42] text-[10px] font-black uppercase text-slate-500">
                        <tr>
                          <th className="p-2.5">Entity / Table</th>
                          <th className="p-2.5 text-right">Active Count</th>
                          <th className="p-2.5 text-right">Restored Count</th>
                          <th className="p-2.5 text-right">Change</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-[#3A3D42]">
                        {plan.recordDiff.map((diff) => (
                          <tr key={diff.entityName} className="hover:bg-slate-50 dark:hover:bg-[#202225]">
                            <td className="p-2.5 font-bold text-slate-800 dark:text-slate-200">{diff.entityName}</td>
                            <td className="p-2.5 text-right font-mono">{diff.currentCount}</td>
                            <td className="p-2.5 text-right font-mono font-bold">{diff.restoredCount}</td>
                            <td className="p-2.5 text-right font-mono font-bold">
                              <span
                                className={clsx(
                                  'px-1.5 py-0.5 rounded text-[10px]',
                                  diff.delta > 0
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                                    : diff.delta < 0
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400'
                                    : 'text-slate-500'
                                )}
                              >
                                {diff.delta > 0 ? `+${diff.delta}` : diff.delta}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Step 4: Strict Confirmation */}
              {step === 4 && (
                <div className="space-y-4 text-xs">
                  <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-600 rounded-xl space-y-2 text-rose-900 dark:text-rose-200">
                    <div className="font-black uppercase flex items-center space-x-2 text-sm">
                      <ShieldAlert className="w-5 h-5 text-rose-600" />
                      <span>Critical Warning: Active Database Replacement</span>
                    </div>
                    <p className="text-xs">
                      Executing this operation will lock the application, close active SQLite connections, and replace the database with the snapshot from{' '}
                      <span className="font-bold">{new Date(plan.backupTimestamp).toLocaleString()}</span>.
                    </p>
                    <p className="text-[11px] font-medium text-rose-700 dark:text-rose-300">
                      A pre-restore safety backup will be created automatically before swapping. If anything fails, the system will automatically roll back.
                    </p>
                  </div>

                  <div className="space-y-2 pt-2">
                    <label className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 block">
                      Type exact confirmation phrase to authorize:
                    </label>
                    <div className="text-[11px] text-slate-500 font-mono">
                      Target phrase: <span className="font-black text-rose-600">RESTORE CONFIRM</span>
                    </div>
                    <input
                      type="text"
                      value={confirmationInput}
                      onChange={(e) => setConfirmationInput(e.target.value)}
                      placeholder="Type RESTORE CONFIRM"
                      className="w-full px-3 py-2.5 bg-slate-50 dark:bg-[#202225] border-2 border-slate-900 dark:border-[#4A4D52] rounded-xl font-mono text-sm font-bold text-slate-900 dark:text-[#F2F3F5] focus:outline-none focus:border-rose-600"
                    />
                  </div>
                </div>
              )}

              {/* Step 5: Execution & Progress */}
              {step === 5 && (
                <div className="py-6 space-y-4 text-center">
                  {executing && (
                    <div className="space-y-3">
                      <Loader2 className="w-10 h-10 animate-spin text-rose-600 mx-auto" />
                      <div className="text-sm font-black uppercase text-slate-900 dark:text-[#F2F3F5]">
                        Executing Controlled Restoration...
                      </div>
                      <div className="text-xs text-slate-500">
                        Acquiring exclusive restore lock &rarr; Creating safety backup &rarr; Sanitizing WAL &rarr; Performing atomic swap &rarr; Verifying constraints...
                      </div>
                    </div>
                  )}

                  {!executing && executionResult && (
                    <div className="space-y-3">
                      <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-8 h-8" />
                      </div>
                      <h3 className="text-base font-black uppercase text-emerald-700 dark:text-emerald-400">
                        Database Restored Successfully!
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300">
                        {executionResult.message}
                      </p>
                      <div className="p-3 bg-slate-50 dark:bg-[#202225] border rounded-xl text-left text-xs font-mono space-y-1">
                        <div><span className="font-bold">Operation ID:</span> {executionResult.operationId}</div>
                        <div className="truncate"><span className="font-bold">Safety Backup:</span> {executionResult.preRestoreBackupPath}</div>
                      </div>
                    </div>
                  )}

                  {!executing && error && (
                    <div className="space-y-3">
                      <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                        <RotateCcw className="w-8 h-8" />
                      </div>
                      <h3 className="text-base font-black uppercase text-rose-700 dark:text-rose-400">
                        Restoration Stopped
                      </h3>
                      <p className="text-xs text-rose-600">
                        {error}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 border-t border-slate-200 dark:border-[#3A3D42] flex items-center justify-between bg-slate-50 dark:bg-[#202225] rounded-b-2xl">
          {step > 1 && step < 5 && (
            <button
              onClick={() => setStep((s) => (s - 1) as any)}
              className="px-3 py-2 border border-slate-300 dark:border-[#4A4D52] bg-white dark:bg-[#18191C] text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold flex items-center space-x-1.5 hover:bg-slate-100"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
          )}

          <div className="flex-1" />

          {step === 1 && plan?.canExecuteRestore && (
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2 bg-slate-900 dark:bg-[#1ED760] text-white dark:text-slate-950 rounded-lg text-xs font-bold flex items-center space-x-1.5 hover:bg-slate-800"
            >
              <span>Review Invariants</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 2 && (
            <button
              onClick={() => setStep(3)}
              className="px-4 py-2 bg-slate-900 dark:bg-[#1ED760] text-white dark:text-slate-950 rounded-lg text-xs font-bold flex items-center space-x-1.5 hover:bg-slate-800"
            >
              <span>Simulate Record Diff</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 3 && (
            <button
              onClick={() => setStep(4)}
              className="px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-black uppercase tracking-wider flex items-center space-x-1.5 hover:bg-rose-700 shadow-sm"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Proceed to Authorization</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 4 && (
            <button
              onClick={handleExecuteRestore}
              disabled={confirmationInput !== 'RESTORE CONFIRM' || executing}
              className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-black uppercase tracking-wider flex items-center space-x-2 shadow-sm transition-colors"
            >
              <Database className="w-4 h-4" />
              <span>Execute Controlled Restore</span>
            </button>
          )}

          {step === 5 && !executing && (
            <button
              onClick={() => {
                onClose();
                window.location.reload();
              }}
              className="px-5 py-2 bg-slate-900 dark:bg-[#1ED760] text-white dark:text-slate-950 rounded-lg text-xs font-bold"
            >
              Finish &amp; Reload Application
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
