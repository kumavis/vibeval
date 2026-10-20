0.80000000000000004::advanced_ai.
0.059999999999999998::bio_enable_release.
0.029999999999999999::bio_threshold.
0.40000000000000002::military_integration.
0.014999999999999999::ai_nuclear_escalation.
0.34999999999999998::nuclear_threshold.
0.02::ai_control_catastrophe.
p_doom :- advanced_ai, bio_enable_release, bio_threshold.
p_doom :- advanced_ai, military_integration, ai_nuclear_escalation, nuclear_threshold.
p_doom :- advanced_ai, ai_control_catastrophe.
query(p_doom).
