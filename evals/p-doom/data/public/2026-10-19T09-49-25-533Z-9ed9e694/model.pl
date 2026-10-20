0.059999999999999998::bio_release.
0.0030000000000000001::bio_mass.
0.5::military_ai_deployment.
0.02::nuclear_escalation.
0.050000000000000003::nuclear_mass.
0.5::critical_ai_deployment.
0.02::systemic_loss_control.
0.02::systemic_mass.
p_doom :- bio_release, bio_mass.
p_doom :- military_ai_deployment, nuclear_escalation, nuclear_mass.
p_doom :- critical_ai_deployment, systemic_loss_control, systemic_mass.
query(p_doom).
