0.75::high_autonomy.
0.12::agent_failure.
0.050000000000000003::agent_fatal.
0.90000000000000002::bio_access.
0.014999999999999999::bio_release.
0.040000000000000001::bio_fatal.
0.80000000000000004::military_ai.
0.0050000000000000001::nuclear_escalation.
0.14999999999999999::nuclear_fatal.
0.59999999999999998::infra_deploy.
0.014999999999999999::infra_cascade.
0.01::infra_fatal.
agent_path :- high_autonomy, agent_failure, agent_fatal.
bio_path :- bio_access, bio_release, bio_fatal.
nuclear_path :- military_ai, nuclear_escalation, nuclear_fatal.
infrastructure_path :- high_autonomy, infra_deploy, infra_cascade, infra_fatal.
p_doom :- agent_path.
p_doom :- bio_path.
p_doom :- nuclear_path.
p_doom :- infrastructure_path.
query(agent_path).
query(bio_path).
query(infrastructure_path).
query(nuclear_path).
query(p_doom).
