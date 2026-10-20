0.80000000000000004::high_stakes_ai_use.
0.55000000000000004::autonomous_critical_deployment.
0.080000000000000002::control_loss.
0.080000000000000002::loss_catastrophe.
0.040000000000000001::ai_bio_release.
0.080000000000000002::bio_global_spread.
0.040000000000000001::bio_mass_fatality.
0.080000000000000002::ai_nuclear_escalation.
0.050000000000000003::nuclear_use.
0.10000000000000001::high_soot_exchange.
0.40000000000000002::nuclear_mass_fatality.
p_doom :- high_stakes_ai_use, autonomous_critical_deployment, control_loss, loss_catastrophe.
p_doom :- ai_bio_release, bio_global_spread, bio_mass_fatality.
p_doom :- high_stakes_ai_use, ai_nuclear_escalation, nuclear_use, high_soot_exchange, nuclear_mass_fatality.
query(p_doom).
