-- 004_seed_users_and_holidays.sql
-- Seed 9 support agents + 1 lead (password: 'Password123!')
-- Seed 2026 Indian / Kerala festival and public holidays

-- 1. Support Agents and Lead
INSERT INTO users (id, name, email, password_hash, role)
VALUES
  ('a0000000-0000-0000-0000-000000000000', 'Lead Supervisor', 'lead@arvosystems.com', '$2b$10$ewSj8FK0iAocQgk7Qi7goeKmmcjk5nZp/3jL4epP3lsWqbWm4IHHG', 'lead'),
  ('a0000000-0000-0000-0000-000000000001', 'Agent One', 'agent1@arvosystems.com', '$2b$10$ewSj8FK0iAocQgk7Qi7goeKmmcjk5nZp/3jL4epP3lsWqbWm4IHHG', 'agent'),
  ('a0000000-0000-0000-0000-000000000002', 'Agent Two', 'agent2@arvosystems.com', '$2b$10$ewSj8FK0iAocQgk7Qi7goeKmmcjk5nZp/3jL4epP3lsWqbWm4IHHG', 'agent'),
  ('a0000000-0000-0000-0000-000000000003', 'Agent Three', 'agent3@arvosystems.com', '$2b$10$ewSj8FK0iAocQgk7Qi7goeKmmcjk5nZp/3jL4epP3lsWqbWm4IHHG', 'agent'),
  ('a0000000-0000-0000-0000-000000000004', 'Agent Four', 'agent4@arvosystems.com', '$2b$10$ewSj8FK0iAocQgk7Qi7goeKmmcjk5nZp/3jL4epP3lsWqbWm4IHHG', 'agent'),
  ('a0000000-0000-0000-0000-000000000005', 'Agent Five', 'agent5@arvosystems.com', '$2b$10$ewSj8FK0iAocQgk7Qi7goeKmmcjk5nZp/3jL4epP3lsWqbWm4IHHG', 'agent'),
  ('a0000000-0000-0000-0000-000000000006', 'Agent Six', 'agent6@arvosystems.com', '$2b$10$ewSj8FK0iAocQgk7Qi7goeKmmcjk5nZp/3jL4epP3lsWqbWm4IHHG', 'agent'),
  ('a0000000-0000-0000-0000-000000000007', 'Agent Seven', 'agent7@arvosystems.com', '$2b$10$ewSj8FK0iAocQgk7Qi7goeKmmcjk5nZp/3jL4epP3lsWqbWm4IHHG', 'agent'),
  ('a0000000-0000-0000-0000-000000000008', 'Agent Eight', 'agent8@arvosystems.com', '$2b$10$ewSj8FK0iAocQgk7Qi7goeKmmcjk5nZp/3jL4epP3lsWqbWm4IHHG', 'agent'),
  ('a0000000-0000-0000-0000-000000000009', 'Agent Nine', 'agent9@arvosystems.com', '$2b$10$ewSj8FK0iAocQgk7Qi7goeKmmcjk5nZp/3jL4epP3lsWqbWm4IHHG', 'agent')
ON CONFLICT (email) DO NOTHING;

-- 2. 2026 Kerala / Indian Festival and Public Holidays
INSERT INTO holidays (holiday_date, name, description)
VALUES
  ('2026-01-26', 'Republic Day', 'National Holiday'),
  ('2026-03-20', 'Eid-ul-Fitr (Ramzan)', 'Festival Holiday (verify dates)'),
  ('2026-04-03', 'Good Friday', 'Public Holiday'),
  ('2026-04-14', 'Vishu / Ambedkar Jayanti', 'Kerala Regional Festival'),
  ('2026-05-01', 'May Day / Labour Day', 'Public Holiday'),
  ('2026-05-27', 'Bakrid / Eid-ul-Adha', 'Festival Holiday (verify dates)'),
  ('2026-08-15', 'Independence Day', 'National Holiday'),
  ('2026-08-26', 'Thiruvonam (First Onam)', 'Kerala Harvest Festival (verify dates)'),
  ('2026-08-27', 'Third Onam', 'Kerala Harvest Festival (verify dates)'),
  ('2026-10-02', 'Gandhi Jayanti', 'National Holiday'),
  ('2026-10-20', 'Mahanavami / Vijayadashami', 'Festival Holiday (verify dates)'),
  ('2026-11-08', 'Deepavali (Diwali)', 'Festival Holiday (verify dates)'),
  ('2026-12-25', 'Christmas', 'Public Holiday')
ON CONFLICT (holiday_date) DO NOTHING;

