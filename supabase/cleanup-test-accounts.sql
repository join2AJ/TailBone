-- One-off: removes the temporary accounts and data created while testing the dashboard (6 Nov 2026).
-- Safe to run more than once. Delete this file afterwards if you like.
delete from public.site_content where key = 'launch';
delete from public.site_content_history;
delete from public.audit_log where actor like 'tb-test-%@tailbone-test.invalid';
delete from public.staff where email like 'tb-test-%@tailbone-test.invalid';
delete from auth.users where email like 'tb-test-%@tailbone-test.invalid';
select (select count(*) from auth.users where email like 'tb-test-%') as test_users_left,
       (select count(*) from public.site_content) as content_rows_left,
       (select count(*) from public.staff) as staff_rows;
