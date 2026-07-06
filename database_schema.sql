-- MAD Training Studio — Database Schema for Supabase PostgreSQL
-- Run this SQL in the Supabase SQL Editor to create all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Users Table (extends Supabase Auth users) ────────────────────────────────
-- Supabase Auth already manages users.id, email, created_at, etc.
-- This table stores additional app-specific profile data.

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    avatar_url TEXT,
    language_pair TEXT DEFAULT 'English ↔ Arabic',
    native_language TEXT DEFAULT 'Arabic',
    target_language TEXT DEFAULT 'English',
    plan_tier TEXT DEFAULT 'free',  -- free, student, professional, studio_pro
    plan_expires_at TIMESTAMPTZ,
    onboarding_complete BOOLEAN DEFAULT FALSE,
    category TEXT,  -- A, B, C (from onboarding)
    current_phase INTEGER DEFAULT 1,
    current_module TEXT DEFAULT 'M001',
    total_xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    streak_days INTEGER DEFAULT 0,
    last_practice_date DATE,
    total_practice_minutes INTEGER DEFAULT 0,
    total_sessions INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policy: users can only read/write their own profile
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- ── Sessions Table (training sessions) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.training_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,  -- shadowing, consecutive, simultaneous, etc.
    field TEXT DEFAULT 'general',
    specialization TEXT DEFAULT 'general',
    direction TEXT DEFAULT 'English → Arabic',
    difficulty TEXT DEFAULT 'moderate',
    topic TEXT,
    source_text TEXT,
    rendition_text TEXT,
    overall_score NUMERIC(5,2),
    accuracy NUMERIC(5,2),
    completeness NUMERIC(5,2),
    terminology NUMERIC(5,2),
    fluency NUMERIC(5,2),
    register_preservation NUMERIC(5,2),
    professional_protocol NUMERIC(5,2),
    grade TEXT,  -- A, B, C, D, F
    feedback_json JSONB,
    duration_minutes INTEGER DEFAULT 0,
    session_type TEXT DEFAULT 'practice',  -- practice or simulation
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on sessions
ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
    ON public.training_sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own sessions"
    ON public.training_sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own sessions"
    ON public.training_sessions FOR DELETE
    USING (auth.uid() = user_id);

-- ── Module Progress Table ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.module_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    module_id TEXT NOT NULL,  -- M001, M002, etc.
    status TEXT DEFAULT 'locked',  -- locked, unlocked, passed
    score NUMERIC(5,2) DEFAULT 0,
    attempts INTEGER DEFAULT 0,
    passed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, module_id)
);

ALTER TABLE public.module_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own module progress"
    ON public.module_progress FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own module progress"
    ON public.module_progress FOR ALL
    USING (auth.uid() = user_id);

-- ── Field Unlocks Table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.field_unlocks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    field TEXT NOT NULL,  -- medical, legal, business, etc.
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, field)
);

ALTER TABLE public.field_unlocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own field unlocks"
    ON public.field_unlocks FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can add own field unlocks"
    ON public.field_unlocks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ── Achievements Table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.achievements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,  -- first_steps, shadow_walker, etc.
    earned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);

ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own achievements"
    ON public.achievements FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can add own achievements"
    ON public.achievements FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ── Glossaries / Key Terms Table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.glossaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    field TEXT DEFAULT 'general',
    language_pair TEXT DEFAULT 'English → Arabic',
    terms_json JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.glossaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own glossaries"
    ON public.glossaries FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own glossaries"
    ON public.glossaries FOR ALL
    USING (auth.uid() = user_id);

-- ── Notes Table ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notes"
    ON public.notes FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own notes"
    ON public.notes FOR ALL
    USING (auth.uid() = user_id);

-- ── Indexes for performance ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.training_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON public.training_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_module_progress_user_id ON public.module_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON public.achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_glossaries_user_id ON public.glossaries(user_id);

-- ── Function: Update updated_at timestamp ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to profiles
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Apply trigger to module_progress
CREATE TRIGGER update_module_progress_updated_at
    BEFORE UPDATE ON public.module_progress
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ── Function: Auto-create profile on user signup ─────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, created_at, updated_at)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NOW(), NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: when a new user is created in auth.users, create a profile
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();
