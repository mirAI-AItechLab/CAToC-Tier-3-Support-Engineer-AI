"use client";
import { useAuth } from "@/components/AuthWrapper";

export default function GlobalHeader() {
  const { operatorName, isDemo, logout } = useAuth();

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b px-6 py-3 bg-white shadow-sm">
      <div className="flex items-center gap-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white font-bold text-sm shadow-md">
          C
        </div>
        
        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
          CAToC
        </h1>
        
        {isDemo && (
          <span className="ml-2 bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded-full border border-amber-200 font-bold uppercase tracking-wide">
            Demo Mode
          </span>
        )}
      </div>
      
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-sm font-medium text-slate-700">{operatorName}</div>
          <div className="text-xs text-gray-500">Tier-3 Engineer</div>
        </div>
        <button 
          onClick={logout}
          className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded text-slate-600 transition-colors"
        >
          Exit
        </button>
      </div>
    </header>
  );
}