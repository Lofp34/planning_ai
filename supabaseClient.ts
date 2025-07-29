import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cpyxukkldzafthflneev.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNweXh1a2tsZHphZnRoZmxuZWV2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM3NzQ3MTcsImV4cCI6MjA2OTM1MDcxN30.LUFofzMpiqbeZH51NQHeXpUbId1JCNlCfu7kQXc7wEU'

export const supabase = createClient(supabaseUrl, supabaseAnonKey) 