0.080000000000000002::bio_ai_outbreak.
0.014999999999999999::bio_mass_threshold.
0.029999999999999999::ai_nuclear_use.
0.20000000000000001::nuclear_escalation.
0.5::nuclear_mass_threshold.
0.040000000000000001::ai_control_disruption.
0.02::control_mass_threshold.
p_doom :- bio_ai_outbreak, bio_mass_threshold.
p_doom :- ai_nuclear_use, nuclear_escalation, nuclear_mass_threshold.
p_doom :- ai_control_disruption, control_mass_threshold.
query(p_doom).
