"use client";

import { useEffect, useState, createContext, useContext } from "react";
import { signInWithPopup, User, signOut } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";

type AuthContextType = {
  user: User | null;      
  isDemo: boolean;        
  operatorName: string;   
  login: () => void;      
  logout: () => void;     
  enterDemo: () => void;  
};

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

export default function AuthWrapper({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setIsDemo(false); 
    } catch (e) {
      console.error("Login failed", e);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setIsDemo(false);
  };

  const enterDemo = () => {
    setIsDemo(true);
  };

  const operatorName = user ? (user.displayName || "Support Engineer") : "Guest Operator";

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">Loading...</div>;
  }

  if (!user && !isDemo) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">          
          <div className="bg-slate-900 p-8 text-center">
            <h1 className="text-3xl font-bold text-white mb-2">CAToC</h1>
            <p className="text-blue-200 text-sm">サポートオーケストレーションエージェント</p>
          </div>

          <div className="p-8 space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-xl font-semibold text-gray-800">ログイン</h2>
              <p className="text-sm text-gray-500">
                アカウントにログインして、サポート業務を開始します。<br/>
                (Google Workspace / Gmail アカウント対応)
              </p>
            </div>

            <button onClick={login}
              className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 text-gray-700 font-medium py-3 px-4 rounded-lg hover:bg-gray-50 transition-all duration-200 focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>              
              Google アカウントで続行
            </button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">または</span>
              </div>
            </div>

            <button
              onClick={enterDemo}
              className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-700 transition-all duration-200 shadow-md hover:shadow-lg"
            >
              ログインせずにデモを開始 (Guest)
            </button>
            
            <p className="text-xs text-center text-gray-400 mt-4">
              ※ デモモードでは担当者情報が引き継がれませんが、<br/>機能を十分にお試しいただけます。
            </p>
          </div>
        </div>
        
        <div className="mt-8 text-center text-gray-400 text-xs">
          © 2026 Neurorin Inc. All rights reserved.
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, isDemo, operatorName, login, logout, enterDemo }}>
      {children}
    </AuthContext.Provider>
  );
}