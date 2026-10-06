The first synthetic probe run reproduced the defects and saved the alternative
scope/add/split/goal/design outputs. Native assistance record and prepare both
returned exit 0; prepare returned status=applied, recorded=true.

The harness then incorrectly expected association.status instead of the documented
association string. Its thrown message did not indicate a product gate or failure.
The assertion was corrected. The final probe run uses new isolated fixture roots;
it does not prepare again in the already-created fixture or rerun real business work.
