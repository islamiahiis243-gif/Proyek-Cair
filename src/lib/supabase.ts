import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SupabaseConfig, UserProfile } from '../types';

const STORAGE_KEY_USER = 'proyek_cair_user';
export const DEFAULT_USER: UserProfile = { id:'', name:'Pengguna', email:'', role:'User', provider:'guest' };
const env = (import.meta as any).env || {};
const SUPABASE_URL = (env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL) as string | undefined;
const SUPABASE_KEY = (env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY) as string | undefined;

let supabaseInstance: SupabaseClient | null = null;
export function getSupabaseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Konfigurasi Supabase belum tersedia. Hubungi administrator UDU.');
  }
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return supabaseInstance;
}

export function getStoredConfig(): SupabaseConfig {
  return { url: SUPABASE_URL || '', anonKey: SUPABASE_KEY || '', isConnected: Boolean(SUPABASE_URL && SUPABASE_KEY) };
}
export function saveStoredConfig(_config: SupabaseConfig): void {
  // Runtime credentials are deployment environment variables, never browser localStorage.
}
export function getStoredUser(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_USER);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { id: '', name: 'Pengguna', email: '', role: 'Viewer', provider: 'guest' };
}
export function saveStoredUser(user: UserProfile): void {
  localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
}
export async function initiateGoogleSignIn(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) throw error;
}
export async function signOutSupabase(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;
  localStorage.removeItem(STORAGE_KEY_USER);
}
export async function testSupabaseConnection(_url?: string, _anonKey?: string): Promise<{success:boolean;message:string}> {
  try {
    const { error } = await getSupabaseClient().from('boq_items').select('id').limit(1);
    if (error) return { success:false, message:error.message };
    return { success:true, message:'Terhubung ke database UDU.' };
  } catch (error:any) {
    return { success:false, message:error.message || 'Koneksi gagal.' };
  }
}

export interface ActiveContextPersona { persona_code:string; display_name:string; description:string }
export interface ActiveContextWorkspace {
  id: string;
  type: 'PERSONAL' | 'COMPANY';
  name: string;
  status: string;
  company_id: string | null;
  company_npwp?: string;
  is_company_super_admin?: boolean;
  access_basis: string;
  personas?: ActiveContextPersona[];
  active_persona_code?: string | null;
}
export interface ActiveContextProject {
  id: string;
  workspace_id: string;
  company_id?: string;
  company_name?: string;
  company_npwp?: string;
  project_code: string | null;
  name: string;
  status: string;
  membership_id: string;
  role_code?: string;
  role_name?: string;
  permissions: string[];
}
export interface ActiveContext { authenticated:boolean; user_id?:string; is_platform_super_admin?:boolean; workspaces:ActiveContextWorkspace[]; projects:ActiveContextProject[] }
export async function resolveMyActiveContext():Promise<ActiveContext>{
 const {data,error}=await getSupabaseClient().rpc('resolve_my_active_context');
 if(error) throw new Error('Gagal memverifikasi konteks akses server: '+error.message);
 if(!data || data.authenticated!==true || !Array.isArray(data.workspaces) || !Array.isArray(data.projects)) throw new Error('Konteks akses server tidak valid atau sesi tidak terautentikasi.');
 return data as ActiveContext;
}
