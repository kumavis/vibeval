0.84999999999999998::cap_autonomous_offense.
0.10000000000000001::grid_attack_attempt.
0.0030000000000000001::grid_mass_lethality.
0.5::cap_ai_bio_uplift.
0.0050000000000000001::bio_release_attempt.
0.050000000000000003::bio_mass_lethality.
0.02::loss_of_control_event.
0.14999999999999999::loss_of_control_lethality.
0.0080000000000000002::war_escalation.
0.050000000000000003::war_mass_lethality.
grid_attack_occurs :- cap_autonomous_offense, grid_attack_attempt.
grid_catastrophe :- grid_attack_occurs, grid_mass_lethality.
bio_release_occurs :- cap_ai_bio_uplift, bio_release_attempt.
bio_catastrophe :- bio_release_occurs, bio_mass_lethality.
loss_of_control_occurs :- cap_autonomous_offense, loss_of_control_event.
loss_of_control_catastrophe :- loss_of_control_occurs, loss_of_control_lethality.
war_escalation_occurs :- cap_autonomous_offense, war_escalation.
war_catastrophe :- war_escalation_occurs, war_mass_lethality.
p_doom :- grid_catastrophe.
p_doom :- bio_catastrophe.
p_doom :- loss_of_control_catastrophe.
p_doom :- war_catastrophe.
query(bio_catastrophe).
query(bio_release_occurs).
query(grid_attack_occurs).
query(grid_catastrophe).
query(loss_of_control_catastrophe).
query(loss_of_control_occurs).
query(p_doom).
query(war_catastrophe).
query(war_escalation_occurs).
