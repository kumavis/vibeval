0.029999999999999999::bio_ai_pathway.
0.029999999999999999::bio_threshold.
0.040000000000000001::nuclear_ai_escalation.
0.050000000000000003::nuclear_threshold.
0.029999999999999999::control_failure.
0.040000000000000001::control_threshold.
p_doom :- bio_ai_pathway, bio_threshold.
p_doom :- nuclear_ai_escalation, nuclear_threshold.
p_doom :- control_failure, control_threshold.
query(p_doom).
