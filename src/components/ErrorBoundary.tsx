import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Terjadi kesalahan tidak terduga.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught application error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let parsedDetail = this.state.errorMessage;
      let isQuota = false;

      try {
        const parsed = JSON.parse(this.state.errorMessage) as {
          error?: string;
          operationType?: string;
          path?: string;
        };
        if (parsed.error) {
          parsedDetail = `${parsed.error} (Operasi: ${parsed.operationType || '-'}, Jalur: ${parsed.path || '-'})`;
        }
      } catch {
        // Non-JSON error message
      }

      if (parsedDetail.toLowerCase().includes('quota exceeded')) {
        isQuota = true;
      }

      return (
        <div className="min-h-screen bg-[#e2e8da] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#f7f9f4] border border-[#cbe0b0] rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-700">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h1 className="text-base font-bold text-[#263015]">
                {isQuota ? 'Batas Kuota Harian Tercapai' : 'Gangguan Pemrosesan Data'}
              </h1>
            </div>
            <p className="text-xs text-[#5b6649] leading-relaxed break-words">
              {isQuota
                ? 'Kuota harian gratis database telah tercapai dan akan diperbarui otomatis pada hari berikutnya.'
                : parsedDetail}
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#f7f9f4] bg-[#586826] rounded-full hover:bg-[#48561e] transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Muat Ulang Aplikasi</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
