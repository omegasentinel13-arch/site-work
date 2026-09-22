'use client';

import React, { useState, useRef } from 'react';
import { UploadCloud, FileCheck, AlertTriangle, XCircle, CheckCircle2, Loader2, Database, ShieldAlert, ArrowRight } from 'lucide-react';
import { clsx } from 'clsx';
import { BackupManifest, ConflictItem } from '@/lib/backup/types';

interface BackupUploadZoneProps {
  isAdmin: boolean;
  onInitiateRestore?: (file: File, validationData: any) => void;
}

export function BackupUploadZone({ isAdmin, onInitiateRestore }: BackupUploadZoneProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    isValid: boolean;
    hasBlockingIssues: boolean;
    conflicts: ConflictItem[];
    manifest?: BackupManifest;
    dbMetrics?: any;
    filesCatalog?: any[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    if (!file.name.endsWith('.zip')) {
      setError('Invalid file type: Backup archives must be .zip files.');
      return;
    }

    setSelectedFile(file);
    setError(null);
    setValidationResult(null);
    setValidating(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/backup/validate', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Validation failed.');
      }

      setValidationResult(data);
    } catch (err: any) {
      setError(err.message || 'Failed to validate uploaded archive.');
    } finally {
      setValidating(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const resetSelection = () => {
    setSelectedFile(null);
    setValidationResult(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#2B2D31]">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-[#202225] border border-slate-800 dark:border-[#4A4D52] flex items-center justify-center text-amber-400 dark:text-[#1ED760] shadow-sm">
            <UploadCloud className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black uppercase text-slate-900 dark:text-[#F2F3F5]">
              Verify &amp; Restore External Archive
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#949BA4]">
              Inspect, validate, and restore an offline or transferred backup ZIP archive.
            </p>
          </div>
        </div>
        {selectedFile && (
          <button
            onClick={resetSelection}
            className="text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            Clear File
          </button>
        )}
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
          }
        }}
      />

      {!selectedFile ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={clsx(
            'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-2',
            dragOver
              ? 'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20'
              : 'border-slate-300 dark:border-[#3A3D42] hover:border-slate-500 bg-slate-50/50 dark:bg-[#202225]/50'
          )}
        >
          <UploadCloud className="w-10 h-10 text-slate-400 dark:text-slate-500" />
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
            Drag and drop backup ZIP file here, or <span className="text-emerald-600 dark:text-[#1ED760] underline">browse files</span>
          </div>
          <div className="text-[10px] text-slate-500">
            Sandbox deep validation runs automatically before any restore action is permitted.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-3 bg-slate-50 dark:bg-[#202225] border border-slate-300 dark:border-[#3A3D42] rounded-xl flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FileCheck className="w-5 h-5 text-emerald-600 dark:text-[#1ED760]" />
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-[#F2F3F5]">{selectedFile.name}</div>
                <div className="text-[10px] text-slate-500">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</div>
              </div>
            </div>
            {validating && (
              <div className="flex items-center space-x-1.5 text-xs text-slate-600 dark:text-slate-300">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Deep Validating...</span>
              </div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-600 rounded-xl text-xs text-rose-800 dark:text-rose-200 flex items-center space-x-2">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {validationResult && (
            <div className="space-y-3 p-4 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-[#3A3D42] rounded-xl text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-[#3A3D42]">
                <div className="flex items-center space-x-2">
                  {validationResult.isValid && !validationResult.hasBlockingIssues ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-[#1ED760]" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-rose-600" />
                  )}
                  <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                    {validationResult.isValid && !validationResult.hasBlockingIssues
                      ? 'Validation Succeeded — Cryptographically Verified'
                      : 'Validation Detected Blocking Issues'}
                  </span>
                </div>

                <span
                  className={clsx(
                    'px-2 py-0.5 rounded text-[10px] font-black uppercase',
                    validationResult.manifest?.restorableAsDatabase
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-700 text-white'
                  )}
                >
                  {validationResult.manifest?.restorableAsDatabase ? 'Restorable DB' : 'Logical Archive'}
                </span>
              </div>

              {/* Manifest Info */}
              {validationResult.manifest && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono bg-white dark:bg-[#18191C] p-2.5 rounded-lg border">
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase">Scope</span>
                    <span className="font-bold">{validationResult.manifest.scope}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase">Period</span>
                    <span className="font-bold">{validationResult.manifest.periodPreset}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase">Timestamp</span>
                    <span className="font-bold">{new Date(validationResult.manifest.backupTimestamp).toLocaleDateString()}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[9px] uppercase">Created By</span>
                    <span className="font-bold">{validationResult.manifest.createdBy.username}</span>
                  </div>
                </div>
              )}

              {/* Conflicts List */}
              {validationResult.conflicts.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {validationResult.conflicts.map((c, i) => (
                    <div
                      key={i}
                      className={clsx(
                        'p-2 rounded-lg border flex items-start space-x-2 text-[11px]',
                        c.severity === 'BLOCKING'
                          ? 'bg-rose-50 border-rose-300 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200'
                          : 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200'
                      )}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">{c.title}:</span> {c.description}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Action Button: Initiate Restore */}
              {isAdmin && validationResult.manifest?.restorableAsDatabase && !validationResult.hasBlockingIssues && (
                <div className="pt-2 flex justify-end">
                  <button
                    onClick={() => {
                      if (onInitiateRestore && selectedFile) {
                        onInitiateRestore(selectedFile, validationResult);
                      }
                    }}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-black uppercase tracking-wider flex items-center space-x-2 shadow-sm transition-colors hit-target-44"
                  >
                    <Database className="w-4 h-4" />
                    <span>Proceed to Controlled Restore</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
