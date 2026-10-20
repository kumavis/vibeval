0.40000000000000002::ai_bio_uplift.
0.050000000000000003::bio_release_given_uplift.
0.050000000000000003::bio_10pct_given_release.
0.29999999999999999::misaligned_agent_capable.
0.029999999999999999::loss_10pct_given_capable.
0.02::ai_war_escalation.
0.10000000000000001::war_10pct_given_escalation.
0.01::ai_infra_failure.
0.050000000000000003::infra_10pct_given_failure.
p_doom :- ai_bio_uplift, bio_release_given_uplift, bio_10pct_given_release.
p_doom :- misaligned_agent_capable, loss_10pct_given_capable.
p_doom :- ai_war_escalation, war_10pct_given_escalation.
p_doom :- ai_infra_failure, infra_10pct_given_failure.
query(p_doom).
