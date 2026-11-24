# Connect the Canvass ERP to Supabase

This setup provides shared lead records and individual team sign-ins. Team members sign in with their email address and password. Do not use a Supabase `service_role` or secret key in the website.

## One-time Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor**, paste in `supabase-setup.sql`, and run it.
3. In **Authentication → Users**, invite the four team members by email. Set each invite's `full_name` metadata to the name the team uses. Invited users create their own password from the Supabase invitation.
4. In **Authentication → Settings**, disable public sign-ups so only invited members can access the ERP.
5. In **Project Settings → API**, copy the **Project URL** and **anon / publishable key**. Keep the `service_role` key private.

## Finish the app connection

Send the Project URL and anon / publishable key so they can be added to the app configuration. These are the public client values; database row-level security in `supabase-setup.sql` restricts records to authenticated team members. Never send a team member's password.

The four users then sign in separately, and the shared Supabase table becomes the common source of lead records across devices.
