0.94999999999999996::capability_deployment.
0.012::bio_release.
0.080000000000000002::bio_mortality.
0.0080000000000000002::nuclear_escalation.
0.45000000000000001::nuclear_mortality.
0.002::system_failure.
0.080000000000000002::system_mortality.
p_doom :- capability_deployment, bio_release, bio_mortality.
p_doom :- capability_deployment, nuclear_escalation, nuclear_mortality.
p_doom :- capability_deployment, system_failure, system_mortality.
query(p_doom).
