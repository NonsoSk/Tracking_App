-- Community master data and automatic classification.
begin;
set search_path = public, extensions, tests;
select plan(14);

create temp view tclass as
select c.name, t.code as type_code, cl.name as cluster, a.is_primary
from public.communities c
join public.community_affiliations a on a.community_id = c.id
join public.community_types t on t.id = a.community_type_id
left join public.clusters cl on cl.id = a.cluster_id;

select is((select count(*)::int from tclass where type_code = 'HOST'), 6, '6 host communities');
select is((select count(*)::int from tclass where type_code = 'PIPELINE'), 31,
  '31 named pipeline communities (32 stated; the missing one is not invented)');
select is((select count(*)::int from public.clusters), 5, '5 pipeline clusters');
select is((select count(*)::int from tclass where type_code = 'INDIRECT'), 10, '10 indirectly impacted communities');
select is((select count(*)::int from tclass where type_code = 'JETTY'), 2, '2 jetty communities');
select results_eq($$select type_code || coalesce('/' || cluster, '') || case when is_primary then '*' else '' end
                    from tclass where name = 'Akpajo' order by type_code$$,
                  array['HOST*', 'PIPELINE/Cluster 1'],
                  'Akpajo is Host (primary) and Pipeline Cluster 1');
select isnt(tests.community('Rumuokwurusi'), tests.community('Rumuokruoshi'),
  'Rumuokwurusi and Rumuokruoshi are separate communities');
select is((select c.name from public.community_aliases a join public.communities c on c.id = a.community_id
           where a.alias_norm = app.norm_key('Wakohu Family')), 'Nwakohu', 'legacy alias Wakohu Family -> Nwakohu');

-- Classification is derived when a grievance is saved.
create temp table g as
select c.name, g.* from (values ('Egbeda'), ('Agbonchia'), ('Onne'), ('Akpajo'), ('Ogale')) c(name),
lateral (select app.create_grievance(
           jsonb_build_object('community_id', tests.community(c.name), 'description', 'Test grievance text for ' || c.name),
           'paper', null, null) as rec) g;

create temp view gc as
select g.name, t.name as type, cl.name as cluster
from g join public.community_types t on t.id = (g.rec).community_type_id
left join public.clusters cl on cl.id = (g.rec).cluster_id;

select is((select type || ' / ' || cluster from gc where name = 'Egbeda'), 'Pipeline / Cluster 5', 'Egbeda -> Pipeline, Cluster 5');
select is((select type || coalesce(' / ' || cluster, '') from gc where name = 'Agbonchia'), 'Host', 'Agbonchia -> Host, no cluster');
select is((select type from gc where name = 'Onne'), 'Jetty', 'Onne -> Jetty');
select is((select type from gc where name = 'Ogale'), 'Indirectly Impacted', 'Ogale -> Indirectly Impacted');
select is((select type from gc where name = 'Akpajo'), 'Host', 'Akpajo defaults to its primary affiliation (Host)');

-- A cluster that doesn't belong to the chosen type is rejected by the master data.
select throws_ok(
  $$insert into public.community_affiliations (community_id, community_type_id, cluster_id)
    values (tests.community('Ogu'), (select id from public.community_types where code = 'HOST'), 1)$$,
  '23514', 'cluster_not_allowed', 'host affiliation cannot carry a cluster');

select * from finish();
rollback;
